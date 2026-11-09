// Actions for the hotel search space.
//
// searchHotels is the live core: it resolves the destination through
// Nominatim (OpenStreetMap), discovers real hotels with ctx.tool.web_search,
// extracts structured hotel facts with ctx.inference, geocodes hotels for
// map pins, and derives walking / transit time estimates from distance.
// Favorites, search history and stay-plan memos are user-owned rows in ctx.db.

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { desc, eq } from "drizzle-orm";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export const AMENITY_KEYS = [
"shower_only",
"bathtub",
"large_bath",
"breakfast",
"wifi",
"parking",
"gym",
"pool",
"laundry",
"kitchen",
"nonsmoking",
] as const;

const amenityKey = z.enum(AMENITY_KEYS);

const hotelSchema = z.object({
name: z.string(),
priceFromJpy: z.number().nullable(),
rating: z.number().nullable(),
ratingScale: z.number().nullable(),
reviewCount: z.number().nullable(),
walkMinutes: z.number().nullable(),
walkBasis: z.enum(["stated", "estimated"]).nullable(),
transitMinutes: z.number().nullable(),
transitBasis: z.enum(["stated", "estimated"]).nullable(),
distanceKm: z.number().nullable(),
nearestStation: z.string().nullable(),
stationWalkMinutes: z.number().nullable(),
area: z.string().nullable(),
amenities: z.array(amenityKey),
highlights: z.string().nullable(),
sourceUrl: z.string().nullable(),
sourceTitle: z.string().nullable(),
lat: z.number().nullable(),
lon: z.number().nullable(),
});

export type Hotel = z.infer<typeof hotelSchema>;

const destinationSchema = z.object({
query: z.string(),
resolvedName: z.string(),
displayAddress: z.string(),
lat: z.number(),
lon: z.number(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GeoResult = { lat: number; lon: number; name: string; displayName: string};

async function geocode(query: string): Promise<GeoResult | null> {
try {
const url =
"https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ja&q=" +
encodeURIComponent(query);
const res = await fetch(url, {
headers: { "User-Agent": "MuseHotelSearch/1.0 (personal hotel search artifact)"},
});
if (!res.ok) return null;
const arr = (await res.json()) as Array<{
lat: string;
lon: string;
name?: string;
display_name: string;
}>;
const first = arr[0];
if (!first) return null;
const lat = Number.parseFloat(first.lat);
const lon = Number.parseFloat(first.lon);
if (!Number.isFinite(lat) ||!Number.isFinite(lon)) return null;
return { lat, lon, name: first.name?? "", displayName: first.display_name};
} catch {
return null;
}
}

function haversineKm(
a: { lat: number; lon: number},
b: { lat: number; lon: number},
): number {
const R = 6371;
const dLat = ((b.lat - a.lat) * Math.PI) / 180;
const dLon = ((b.lon - a.lon) * Math.PI) / 180;
const s =
Math.sin(dLat / 2) ** 2 +
Math.cos((a.lat * Math.PI) / 180) *
Math.cos((b.lat * Math.PI) / 180) *
Math.sin(dLon / 2) ** 2;
return 2 * R * Math.asin(Math.sqrt(s));
}

/** Walking minutes: road distance ≈ straight line × 1.25, at 80 m/min. */
function walkEstimateMinutes(distanceKm: number): number {
return Math.max(1, Math.round((distanceKm * 1250) / 80));
}

/**
* Transit estimate: if walking is already quick, transit cannot beat it.
* Otherwise access walk + wait + rail ride (effective ~28 km/h incl. stops)
* + egress walk.
*/
function transitEstimateMinutes(distanceKm: number, walkMin: number): number {
if (walkMin <= 10) return walkMin;
const ride = Math.round((distanceKm / 28) * 60);
return Math.min(walkMin, 5 + 4 + ride + 4);
}

/**
 * Hotel geocoding via Photon (OpenStreetMap data). Photon tolerates parallel
 * requests and accepts a lat/lon bias toward the destination; Nominatim's
 * 1 req/s policy makes parallel calls fail. Results implausibly far from
 * the destination (>30 km, e.g. a same-named branch in another city) are
 * rejected rather than plotted wrong.
 */
async function geocodeHotelPhoton(
name: string,
bias: { lat: number; lon: number } | null,
maxKm: number,
): Promise<GeoResult | null> {
try {
const params = new URLSearchParams({ q: name, limit: "5" });
if (bias) {
params.set("lat", String(bias.lat));
params.set("lon", String(bias.lon));
}
const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
headers: { "User-Agent": "MuseHotelSearch/1.0 (personal hotel search artifact)" },
});
if (!res.ok) return null;
const data = (await res.json()) as {
features?: Array<{
geometry?: { coordinates?: [number, number] };
properties?: { name?: string };
}>;
};
const candidates: GeoResult[] = [];
for (const feature of data.features ?? []) {
const coords = feature?.geometry?.coordinates;
if (!coords) continue;
const [lon, lat] = coords;
if (typeof lat !== "number" || typeof lon !== "number") continue;
if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
candidates.push({
lat,
lon,
name: feature?.properties?.name ?? name,
displayName: "",
});
}
if (candidates.length === 0) return null;
if (!bias) return candidates[0] ?? null;
// Chain hotels share names across cities: pick the candidate closest to
// the destination, and reject it when even the closest is implausibly far.
let best: GeoResult | null = null;
let bestDist = Number.POSITIVE_INFINITY;
for (const c of candidates) {
const d = haversineKm(bias, c);
if (d < bestDist) {
bestDist = d;
best = c;
}
}
if (!best || bestDist > maxKm) return null;
return best;
} catch {
return null;
}
}

function sleep(ms: number): Promise<void> {
return new Promise((resolve) => setTimeout(resolve, ms));
}

const AMENITY_LABELS: Record<(typeof AMENITY_KEYS)[number], string> = {
shower_only: "シャワーのみ",
bathtub: "バスタブ・湯船",
large_bath: "大浴場・温泉",
breakfast: "朝食",
wifi: "無料Wi-Fi",
parking: "駐車場",
gym: "ジム",
pool: "プール",
laundry: "ランドリー",
kitchen: "キッチン",
nonsmoking: "禁煙",
};

const extractSchema = z.object({
hotels: z.array(
z.object({
name: z.string().describe("ホテルの正式名称"),
priceFromJpy: z
.number()
.nullable()
.describe("1泊あたりの最低価格（円）。資料に明記がある場合のみ。なければ null"),
rating: z
.number()
.nullable()
.describe("評価スコア（元の尺度のまま）。なければ null"),
ratingScale: z
.number()
.nullable()
.describe("評価の満点（5や10など）。不明なら null"),
reviewCount: z.number().nullable().describe("口コミ件数。なければ null"),
walkMinutesFromDestination: z
.number()
.nullable()
.describe("目的地からホテルまで徒歩のみの分数。資料に明記がある場合のみ。なければ null"),
transitMinutesFromDestination: z
.number()
.nullable()
.describe("目的地から徒歩＋電車・バスでの分数。資料に「徒歩＆電車で約○分」等の明記がある場合のみ。なければ null"),
distanceKm: z
.number()
.nullable()
.describe("目的地からの距離（km）。資料に明記がある場合のみ。なければ null"),
nearestStation: z.string().nullable().describe("最寄り駅名。なければ null"),
stationWalkMinutes: z
.number()
.nullable()
.describe("最寄り駅からホテルまで徒歩の分数。なければ null"),
area: z.string().nullable().describe("ホテルのあるエリア・住所の一部。なければ null"),
amenities: z
.array(amenityKey)
.describe("資料から裏付けが取れる設備だけ。推測で入れない"),
highlights: z
.string()
.nullable()
.describe("ホテルの特徴を日本語で1文（40字程度）。なければ null"),
sourceIndex: z
.number()
.nullable()
.describe("このホテルの主な情報源となった検索結果の番号。なければ null"),
}),
),
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const Actions = {
searchHotels: defineAction({
description:
"Searches real hotels near a destination (pinpoint venue/address or broader area) with walking and transit time estimates and amenity evidence.",
request: z.object({
destination: z.string().min(1).max(120),
mode: z.enum(["pinpoint", "area"]),
checkin: z.string().max(10).optional(),
checkout: z.string().max(10).optional(),
guests: z.number().int().min(1).max(16).default(2),
maxWalkMinutes: z.number().int().positive().max(180).nullable().default(null),
maxTransitMinutes: z.number().int().positive().max(180).nullable().default(null),
maxPriceJpy: z.number().int().positive().nullable().default(null),
amenities: z.array(amenityKey).max(11).default([]),
sort: z
.enum(["recommended", "walk", "transit", "price", "rating"])
.default("recommended"),
}),
response: z.object({
destination: destinationSchema.nullable(),
hotels: z.array(hotelSchema),
totalFound: z.number(),
excludedByTimeFilter: z.number(),
amenityFilterNote: z.string().nullable(),
sources: z.array(z.object({ title: z.string(), url: z.string()})),
searchedAt: z.string(),
}),
async handler(ctx, args) {
const destQuery = args.destination.trim();
const searchedAt = new Date().toISOString();

// 1) Resolve the destination anchor.
const destGeo = await geocode(destQuery);

// 2) Discover hotels via web search.
const queries: string[] = [
`${destQuery} ホテル おすすめ`,
args.mode === "pinpoint"
? `${destQuery} ホテル 徒歩`
: `${destQuery} ホテル 駅近`,
`${destQuery} ホテル 宿泊料金 評価 口コミ`,
];
if (args.amenities.length > 0) {
const terms = args.amenities
.slice(0, 3)
.map((k) => AMENITY_LABELS[k])
.join(" ");
queries.push(`${destQuery} ホテル ${terms}`);
}

type SearchResult = { title: string; url: string | null; snippet: string | null};
const seenUrls = new Set<string>();
const results: SearchResult[] = [];
const settled = await Promise.allSettled(
queries.map((q) => ctx.tool.web_search(q)),
);
for (const s of settled) {
if (s.status!== "fulfilled") continue;
for (const r of s.value.content.results) {
const key = r.url?? r.title;
if (seenUrls.has(key)) continue;
seenUrls.add(key);
results.push({ title: r.title, url: r.url, snippet: r.snippet});
}
}
const usable = results.slice(0, 10);
const sources = usable
.filter((r): r is SearchResult & { url: string} => typeof r.url === "string")
.map((r) => ({ title: r.title, url: r.url}));

if (usable.length === 0) {
await recordHistory(ctx, args, destQuery, 0);
return {
destination: destGeo
? {
query: destQuery,
resolvedName: destGeo.name || destQuery,
displayAddress: destGeo.displayName,
lat: destGeo.lat,
lon: destGeo.lon,
}
: null,
hotels: [],
totalFound: 0,
excludedByTimeFilter: 0,
amenityFilterNote: null,
sources: [],
searchedAt,
};
}

// 3) Extract structured hotel facts from the search evidence.
const corpus = usable
.map(
(r, i) =>
`[Result ${i}] ${r.title}\nURL: ${r.url ?? "（なし）"}\n${(r.snippet ?? "").slice(0, 2600)}`,
)
.join("\n\n---\n\n");

const modeHint =
args.mode === "pinpoint"
? "目的地はイベント会場や住所などのピンポイントです。徒歩分数はその目的地からのものだけを拾ってください。"
: "目的地は街・駅・地域などのエリアです。徒歩分数が目的地（エリア中心）からのものか駅からのものか曖昧な場合は、駅からの分数として stationWalkMinutes に入れてください。";

const extracted = await ctx.inference.complete(
`目的地は「${destQuery}」です。${modeHint}\n` +
`以下のWeb検索結果から、実在するホテルだけを抽出してください。検索結果に名前が登場しないホテルは作らないでください。` +
`価格・評価・距離・徒歩分数・設備は、検索結果の文章に裏付けがあるものだけを入れ、裏付けがなければ null または空にしてください。` +
`同じホテルが複数資料に出る場合は1件にまとめてください。最大12件まで。\n\n${corpus}`,
{ schema: extractSchema},
);

// 4) Enrich: validate source URLs, geocode hotels, derive times.
const validUrls = new Set(sources.map((s) => s.url));
const hotels: Hotel[] = [];
const rawHotels = extracted.hotels.slice(0, 12);

const maxGeoKm = args.mode === "pinpoint" ? 10 : 15;
const geoByIndex = new Map<number, GeoResult | null>();
await Promise.all(
rawHotels.map(async (h, i) => {
geoByIndex.set(i, await geocodeHotelPhoton(h.name, destGeo, maxGeoKm));
}),
);
// Nominatim fallback for misses: sequential to respect its rate policy.
let fallbackBudget = 4;
for (let i = 0; i < rawHotels.length && fallbackBudget > 0; i++) {
if (geoByIndex.get(i)) continue;
const raw = rawHotels[i];
if (!raw) continue;
fallbackBudget -= 1;
const g = await geocode(raw.name);
if (g && (!destGeo || haversineKm(destGeo, g) <= maxGeoKm)) {
geoByIndex.set(i, g);
}
if (fallbackBudget > 0) await sleep(1050);
}

rawHotels.forEach((h, i) => {
const geo = geoByIndex.get(i) ?? null;
const src =
h.sourceIndex!== null && h.sourceIndex >= 0 && h.sourceIndex < usable.length
? usable[h.sourceIndex]
: undefined;
const sourceUrl =
src?.url && validUrls.has(src.url)? src.url: null;

let distanceKm = h.distanceKm;
if (distanceKm === null && geo && destGeo) {
distanceKm = Math.round(haversineKm(destGeo, geo) * 100) / 100;
}

let walkMinutes = h.walkMinutesFromDestination;
let walkBasis: Hotel["walkBasis"] =
walkMinutes!== null? "stated": null;
if (walkMinutes === null && distanceKm!== null) {
walkMinutes = walkEstimateMinutes(distanceKm);
walkBasis = "estimated";
}

let transitMinutes = h.transitMinutesFromDestination;
let transitBasis: Hotel["transitBasis"] =
transitMinutes!== null? "stated": null;
if (transitMinutes === null && distanceKm!== null && walkMinutes!== null) {
transitMinutes = transitEstimateMinutes(distanceKm, walkMinutes);
transitBasis = "estimated";
}

hotels.push({
name: h.name,
priceFromJpy: h.priceFromJpy,
rating: h.rating,
ratingScale: h.ratingScale,
reviewCount: h.reviewCount,
walkMinutes,
walkBasis,
transitMinutes,
transitBasis,
distanceKm,
nearestStation: h.nearestStation,
stationWalkMinutes: h.stationWalkMinutes,
area: h.area,
amenities: [...new Set(h.amenities)],
highlights: h.highlights,
sourceUrl,
sourceTitle: sourceUrl? (src?.title?? null): null,
lat: geo?.lat?? null,
lon: geo?.lon?? null,
});
});

// Dedupe by name just in case extraction repeated one.
const byName = new Map<string, Hotel>();
for (const h of hotels) {
if (!byName.has(h.name)) byName.set(h.name, h);
}
let list = [...byName.values()];
const totalFound = list.length;

// 5) Filters.
let excludedByTimeFilter = 0;
if (args.maxPriceJpy!== null) {
list = list.filter(
(h) => h.priceFromJpy === null || h.priceFromJpy <= args.maxPriceJpy!,
);
}
list = list.filter((h) => {
if (args.maxWalkMinutes!== null) {
if (h.walkMinutes === null) {
excludedByTimeFilter += 1;
return false;
}
if (h.walkMinutes > args.maxWalkMinutes) {
excludedByTimeFilter += 1;
return false;
}
}
if (args.maxTransitMinutes!== null) {
if (h.transitMinutes === null) {
excludedByTimeFilter += 1;
return false;
}
if (h.transitMinutes > args.maxTransitMinutes) {
excludedByTimeFilter += 1;
return false;
}
}
return true;
});

let amenityFilterNote: string | null = null;
if (args.amenities.length > 0) {
const wanted = new Set<string>(args.amenities);
const withEvidence = list.filter((h) =>
h.amenities.some((a) => wanted.has(a)),
);
if (withEvidence.length > 0) {
list = withEvidence;
amenityFilterNote =
"選択した設備の裏付けが取れたホテルだけを表示しています。設備情報が資料に出ていないホテルは除外されています。";
} else {
amenityFilterNote =
"選択した設備の裏付けが取れたホテルがなかったため、設備では絞り込まず全件を表示しています。各ホテルの設備は情報元でご確認ください。";
}
}

// 6) Sort.
const byWalk = (a: Hotel, b: Hotel) =>
(a.walkMinutes?? 9999) - (b.walkMinutes?? 9999);
const byTransit = (a: Hotel, b: Hotel) =>
(a.transitMinutes?? 9999) - (b.transitMinutes?? 9999);
const byPrice = (a: Hotel, b: Hotel) =>
(a.priceFromJpy?? Number.MAX_SAFE_INTEGER) -
(b.priceFromJpy?? Number.MAX_SAFE_INTEGER);
const ratingNorm = (h: Hotel) =>
h.rating!== null && h.ratingScale
? h.rating / h.ratingScale
: h.rating!== null
? h.rating / 5
: 0;
switch (args.sort) {
case "walk":
list.sort(byWalk);
break;
case "transit":
list.sort(byTransit);
break;
case "price":
list.sort(byPrice);
break;
case "rating":
list.sort((a, b) => ratingNorm(b) - ratingNorm(a));
break;
default:
// Recommended: amenity matches first (when selected), then walk time.
if (args.amenities.length > 0) {
const wanted = new Set<string>(args.amenities);
const matchCount = (h: Hotel) =>
h.amenities.filter((a) => wanted.has(a)).length;
list.sort((a, b) => matchCount(b) - matchCount(a) || byWalk(a, b));
} else {
list.sort(byWalk);
}
}

await recordHistory(ctx, args, destQuery, list.length);

return {
destination: destGeo
? {
query: destQuery,
resolvedName: destGeo.name || destQuery,
displayAddress: destGeo.displayName,
lat: destGeo.lat,
lon: destGeo.lon,
}
: null,
hotels: list,
totalFound,
excludedByTimeFilter,
amenityFilterNote,
sources,
searchedAt,
};
},
}),

listFavorites: defineAction({
description: "Lists the user's saved favorite hotels, newest first.",
request: z.object({ limit: z.number().int().positive().max(100).default(50)}),
response: z.object({
favorites: z.array(
z.object({
id: z.number(),
hotelKey: z.string(),
name: z.string(),
destinationLabel: z.string(),
hotel: hotelSchema,
createdAt: z.string(),
}),
),
}),
async handler(ctx, args) {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.favorites)
.orderBy(desc(schema.favorites.id))
.limit(args.limit);
const favorites = rows.flatMap((row) => {
try {
const hotel = hotelSchema.parse(JSON.parse(row.data));
return [
{
id: row.id,
hotelKey: row.hotelKey,
name: row.name,
destinationLabel: row.destinationLabel,
hotel,
createdAt: row.createdAt.toISOString(),
},
];
} catch {
return [];
}
});
return { favorites};
},
}),

addFavorite: defineAction({
description: "Saves a hotel from search results to the user's favorites.",
request: z.object({
hotel: hotelSchema,
destinationLabel: z.string().min(1).max(200),
}),
response: z.object({ id: z.number()}),
async handler(ctx, args) {
const db = ctx.db<typeof schema>();
const hotelKey = `${args.hotel.name}|${args.destinationLabel}`;
const existing = await db
.select()
.from(schema.favorites)
.where(eq(schema.favorites.hotelKey, hotelKey))
.limit(1);
const found = existing[0];
if (found) return { id: found.id};
const result = await db
.insert(schema.favorites)
.values({
hotelKey,
name: args.hotel.name,
destinationLabel: args.destinationLabel,
data: JSON.stringify(args.hotel),
})
.returning({ id: schema.favorites.id});
const inserted = result[0];
if (!inserted) throw new Error("addFavorite: insert returned no rows");
ctx.invalidateQueries();
return { id: inserted.id};
},
}),

removeFavorite: defineAction({
description: "Removes one favorite hotel by id.",
request: z.object({ id: z.number().int().positive()}),
response: z.object({ ok: z.literal(true)}),
async handler(ctx, args): Promise<{ ok: true}> {
const db = ctx.db<typeof schema>();
await db
.delete(schema.favorites)
.where(eq(schema.favorites.id, args.id));
ctx.invalidateQueries();
return { ok: true};
},
}),

listHistory: defineAction({
description: "Lists the user's recent hotel searches, newest first.",
request: z.object({ limit: z.number().int().positive().max(50).default(12)}),
response: z.object({
history: z.array(
z.object({
id: z.number(),
query: z.string(),
mode: z.enum(["pinpoint", "area"]),
checkin: z.string().nullable(),
checkout: z.string().nullable(),
guests: z.number(),
resultCount: z.number(),
createdAt: z.string(),
}),
),
}),
async handler(ctx, args) {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.searchHistory)
.orderBy(desc(schema.searchHistory.id))
.limit(args.limit);
return {
history: rows.map((row) => ({
id: row.id,
query: row.query,
mode: row.mode,
checkin: row.checkin,
checkout: row.checkout,
guests: row.guests,
resultCount: row.resultCount,
createdAt: row.createdAt.toISOString(),
})),
};
},
}),

deleteHistory: defineAction({
description: "Deletes one search-history entry by id.",
request: z.object({ id: z.number().int().positive()}),
response: z.object({ ok: z.literal(true)}),
async handler(ctx, args): Promise<{ ok: true}> {
const db = ctx.db<typeof schema>();
await db
.delete(schema.searchHistory)
.where(eq(schema.searchHistory.id, args.id));
ctx.invalidateQueries();
return { ok: true};
},
}),

listPlans: defineAction({
description: "Lists the user's stay-plan memos, newest first.",
request: z.object({ limit: z.number().int().positive().max(100).default(50)}),
response: z.object({
plans: z.array(
z.object({
id: z.number(),
hotelName: z.string(),
destinationLabel: z.string(),
checkin: z.string().nullable(),
checkout: z.string().nullable(),
guests: z.number(),
note: z.string(),
sourceUrl: z.string().nullable(),
createdAt: z.string(),
}),
),
}),
async handler(ctx, args) {
const db = ctx.db<typeof schema>();
const rows = await db
.select()
.from(schema.stayPlans)
.orderBy(desc(schema.stayPlans.id))
.limit(args.limit);
return {
plans: rows.map((row) => ({
id: row.id,
hotelName: row.hotelName,
destinationLabel: row.destinationLabel,
checkin: row.checkin,
checkout: row.checkout,
guests: row.guests,
note: row.note,
sourceUrl: row.sourceUrl,
createdAt: row.createdAt.toISOString(),
})),
};
},
}),

createPlan: defineAction({
description: "Creates a stay-plan memo for a hotel the user is considering.",
request: z.object({
hotelName: z.string().min(1).max(200),
destinationLabel: z.string().min(1).max(200),
checkin: z.string().max(10).nullable().default(null),
checkout: z.string().max(10).nullable().default(null),
guests: z.number().int().min(1).max(16).default(2),
note: z.string().max(1000).default(""),
sourceUrl: z.string().max(2000).nullable().default(null),
}),
response: z.object({ id: z.number()}),
async handler(ctx, args) {
const db = ctx.db<typeof schema>();
const result = await db
.insert(schema.stayPlans)
.values({
hotelName: args.hotelName,
destinationLabel: args.destinationLabel,
checkin: args.checkin,
checkout: args.checkout,
guests: args.guests,
note: args.note,
sourceUrl: args.sourceUrl,
})
.returning({ id: schema.stayPlans.id});
const inserted = result[0];
if (!inserted) throw new Error("createPlan: insert returned no rows");
ctx.invalidateQueries();
return { id: inserted.id};
},
}),

deletePlan: defineAction({
description: "Deletes one stay-plan memo by id.",
request: z.object({ id: z.number().int().positive()}),
response: z.object({ ok: z.literal(true)}),
async handler(ctx, args): Promise<{ ok: true}> {
const db = ctx.db<typeof schema>();
await db.delete(schema.stayPlans).where(eq(schema.stayPlans.id, args.id));
ctx.invalidateQueries();
return { ok: true};
},
}),
} satisfies ActionsModule;

async function recordHistory(
ctx: Ctx,
args: { checkin?: string; checkout?: string; guests: number; mode: "pinpoint" | "area"},
query: string,
resultCount: number,
): Promise<void> {
try {
const db = ctx.db<typeof schema>();
await db.insert(schema.searchHistory).values({
query,
mode: args.mode,
checkin: args.checkin?? null,
checkout: args.checkout?? null,
guests: args.guests,
resultCount,
});
ctx.invalidateQueries();
} catch {
// History is best-effort; never fail a search because of it.
}
}
