import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import heroImg from "./assets/hotel-hero.webp";
import "./assets/hatch-maps.js";
import "./assets/hatch-maps.css";
import {
mapsDirectionsUrl,
mapsSearchUrl,
mountMap,
type PlaceRef,
} from "./map_helpers.mjs";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type SearchData = ApiResponse<typeof api, "searchHotels">;
type HotelT = SearchData["hotels"][number];
type AmenityKey = HotelT["amenities"][number];
type SortKey = "recommended" | "walk" | "transit" | "price" | "rating";
type Mode = "pinpoint" | "area";

const AMENITIES: { key: AmenityKey; label: string }[] = [
  { key: "shower_only", label: "シャワーのみ" },
  { key: "bathtub", label: "バスタブ・湯船" },
  { key: "large_bath", label: "大浴場・温泉" },
  { key: "breakfast", label: "朝食あり" },
  { key: "wifi", label: "無料Wi-Fi" },
  { key: "parking", label: "駐車場" },
  { key: "gym", label: "ジム" },
  { key: "pool", label: "プール" },
  { key: "laundry", label: "ランドリー" },
  { key: "kitchen", label: "キッチン" },
  { key: "nonsmoking", label: "禁煙ルーム" },
];
const AMENITY_LABEL = new Map(AMENITIES.map((a) => [a.key, a.label]));

const WALK_OPTIONS: { label: string; value: number | null }[] = [
  { label: "指定なし", value: null },
  { label: "5分以内", value: 5 },
  { label: "10分以内", value: 10 },
  { label: "15分以内", value: 15 },
  { label: "20分以内", value: 20 },
  { label: "30分以内", value: 30 },
];
const TRANSIT_OPTIONS: { label: string; value: number | null }[] = [
  { label: "指定なし", value: null },
  { label: "10分以内", value: 10 },
  { label: "15分以内", value: 15 },
  { label: "20分以内", value: 20 },
  { label: "30分以内", value: 30 },
  { label: "45分以内", value: 45 },
];
const PRICE_OPTIONS: { label: string; value: number | null }[] = [
  { label: "指定なし", value: null },
  { label: "¥8,000以下", value: 8000 },
  { label: "¥12,000以下", value: 12000 },
  { label: "¥18,000以下", value: 18000 },
  { label: "¥25,000以下", value: 25000 },
  { label: "¥40,000以下", value: 40000 },
];

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDateJa(iso: string | null): string {
  if (!iso) return "日付未定";
  const [y = "", m = "", d = ""] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function fmtYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

// ---------------------------------------------------------------------------
// Small icons (inline SVG, stroke style)
// ---------------------------------------------------------------------------

function Icon({
  children,
  size = 16,
  filled = false,
}: {
  children: React.ReactNode;
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const PinIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </Icon>
);
const ClockIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
const TrainIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="5" y="3" width="14" height="13" rx="2" />
    <path d="M5 10h14" />
    <path d="M9 16l-2.5 4M15 16l2.5 4" />
    <circle cx="9" cy="13" r="0.5" />
    <circle cx="15" cy="13" r="0.5" />
  </Icon>
);
const WalkIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <ellipse cx="8" cy="6.5" rx="2.4" ry="3.6" transform="rotate(-14 8 6.5)" />
    <ellipse cx="16" cy="16.5" rx="2.4" ry="3.6" transform="rotate(-14 16 16.5)" />
  </Icon>
);
const StarIcon = ({ size }: { size?: number }) => (
  <Icon size={size} filled>
    <path d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.5l-6 3.3 1.3-6.7-5-4.6 6.8-.8z" />
  </Icon>
);
const HeartIcon = ({ size, filled }: { size?: number; filled?: boolean }) => (
  <Icon size={size} filled={filled}>
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z" />
  </Icon>
);
const NoteIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M9 13h6M9 17h6" />
  </Icon>
);
const TrashIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </Icon>
);
const ExternalIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14L21 3" />
  </Icon>
);
const SearchIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Icon>
);

// ---------------------------------------------------------------------------
// Map script loading + map view
// ---------------------------------------------------------------------------

function ensureMapsLoaded(): Promise<boolean> {
  // hatch-maps.js is bundled with the client and assigns globalThis.HatchMaps.
  const g = globalThis as unknown as { HatchMaps?: unknown };
  return Promise.resolve(Boolean(g.HatchMaps));
}

type MapHandle = {
  selectPlace?: (index: number) => void;
  remove?: () => void;
} | null;

function MapView({
  destination,
  hotels,
  selectedPlaceIndex,
  onSelectPlace,
}: {
  destination: NonNullable<SearchData["destination"]>;
  hotels: HotelT[];
  selectedPlaceIndex: number | null;
  onSelectPlace: (placeIndex: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MapHandle>(null);
  const [unavailable, setUnavailable] = useState(false);

  const places: PlaceRef[] = useMemo(() => {
    const list: PlaceRef[] = [
      { label: destination.resolvedName, lat: destination.lat, lng: destination.lon },
    ];
    for (const h of hotels) {
      if (h.lat !== null && h.lon !== null) {
        list.push({ label: h.name, lat: h.lat, lng: h.lon });
      }
    }
    return list;
  }, [destination, hotels]);

  const placesKey = useMemo(
    () => places.map((p) => `${p.label}:${p.lat},${p.lng}`).join("|"),
    [places],
  );

  useEffect(() => {
    setUnavailable(false);
    let cancelled = false;
    void (async () => {
      const ok = await ensureMapsLoaded();
      if (cancelled) return;
      if (!ok || !containerRef.current) {
        setUnavailable(true);
        return;
      }
      try {
        const handle = mountMap(
          containerRef.current,
          {
            places,
            baseStyle: "light",
            marker: (_place: PlaceRef, index: number, selected: boolean) =>
              index === 0
                ? `<div class="pin pin--dest${selected ? " pin--on" : ""}">◎</div>`
                : `<div class="pin${selected ? " pin--on" : ""}">${index}</div>`,
            onSelectPlace: (index: number | null) => onSelectPlace(index),
          },
          () => setUnavailable(true),
        ) as MapHandle;
        handleRef.current = handle;
        if (!handle) setUnavailable(true);
      } catch {
        setUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
      try {
        handleRef.current?.remove?.();
      } catch {
        // ignore cleanup errors
      }
      handleRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesKey]);

  useEffect(() => {
    if (selectedPlaceIndex !== null) {
      try {
        handleRef.current?.selectPlace?.(selectedPlaceIndex);
      } catch {
        // ignore
      }
    }
  }, [selectedPlaceIndex]);

  if (unavailable) {
    return (
      <div className="border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--dim)]">
        地図を表示できませんでした。ホテル一覧からご確認ください。
      </div>
    );
  }

  return (
    <div>
      <div
        ref={containerRef}
        className="h-[300px] w-full overflow-hidden border border-[var(--border)] md:h-[360px]"
        aria-label="目的地とホテルの地図"
      />
      <p className="mt-1 text-xs text-[var(--dim)]">
        ◎ が目的地、番号ピンがホテルです。ピンを押すと該当ホテルがハイライトされます。座標が得られなかったホテルは一覧のみに表示されます。
      </p>
      <p className="mt-1 text-right text-[11px] text-[var(--dim)]">
        <a
          href="https://www.facebook.com/maps/attribution_terms"
          target="_blank"
          rel="noopener"
          className="underline"
        >
          © OpenStreetMap contributors, Map Data Legal Notices
        </a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hotel card
// ---------------------------------------------------------------------------

function TimeBlock({
  icon,
  label,
  minutes,
  basis,
}: {
  icon: React.ReactNode;
  label: string;
  minutes: number | null;
  basis: "stated" | "estimated" | null;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[11px] tracking-wide text-[var(--dim)]">
        {icon}
        {label}
      </p>
      {minutes !== null ? (
        <p className="tnum mt-0.5 text-lg leading-6 font-semibold text-[var(--text)]">
          約{minutes}
          <span className="text-sm font-medium">分</span>
          <span className="ml-1 align-middle text-[11px] font-normal text-[var(--dim)]">
            {basis === "stated" ? "掲載情報" : "目安"}
          </span>
        </p>
      ) : (
        <p className="mt-0.5 text-sm text-[var(--dim)]">情報なし</p>
      )}
    </div>
  );
}

function HotelCard({
  hotel,
  pinNumber,
  highlighted,
  isFavorite,
  destCoords,
  destLabel,
  onToggleFavorite,
  onPlan,
  onSelect,
}: {
  hotel: HotelT;
  pinNumber: number | null;
  highlighted: boolean;
  isFavorite: boolean;
  destCoords: { lat: number; lng: number } | null;
  destLabel: string;
  onToggleFavorite: () => void;
  onPlan: () => void;
  onSelect?: () => void;
}) {
  const directionsUrl =
    hotel.lat !== null && hotel.lon !== null
      ? mapsDirectionsUrl(
          { label: hotel.name, lat: hotel.lat, lng: hotel.lon },
          destCoords
            ? { origin: destCoords, travelmode: "transit" }
            : undefined,
        )
      : mapsSearchUrl({ label: hotel.name, locality: destLabel });

  const wantedAmenities = hotel.amenities;

  return (
    <article
      className={`border bg-[var(--surface)] px-4 py-4 transition-colors ${
        highlighted
          ? "border-[var(--accent-2)] shadow-[inset_0_0_0_1px_var(--accent-2)]"
          : "border-[var(--border)]"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <div
          className="font-display flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--accent)] text-lg font-semibold text-[var(--accent-ink)]"
          aria-hidden="true"
        >
          {pinNumber !== null ? (
            <span className="tnum text-base">{pinNumber}</span>
          ) : (
            hotel.name.slice(0, 1)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg leading-snug font-semibold text-[var(--text)]">
            {hotel.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--dim)]">
            {hotel.rating !== null && (
              <span className="flex items-center gap-1 text-[var(--gold)]">
                <StarIcon size={14} />
                <span className="tnum font-semibold text-[var(--text)]">
                  {hotel.rating}
                  {hotel.ratingScale ? `/${hotel.ratingScale}` : ""}
                </span>
                {hotel.reviewCount !== null && (
                  <span className="text-[var(--dim)]">
                    （{hotel.reviewCount.toLocaleString("ja-JP")}件）
                  </span>
                )}
              </span>
            )}
            {hotel.area && (
              <span className="flex items-center gap-1">
                <PinIcon size={13} />
                {hotel.area}
              </span>
            )}
            {hotel.distanceKm !== null && (
              <span className="tnum">目的地から約{hotel.distanceKm}km</span>
            )}
          </div>
        </div>
        {hotel.priceFromJpy !== null && (
          <div className="shrink-0 text-right">
            <p className="tnum text-lg leading-6 font-bold text-[var(--accent-2)]">
              {fmtYen(hotel.priceFromJpy)}
              <span className="text-sm">〜</span>
            </p>
            <p className="text-[11px] text-[var(--dim)]">1泊あたり目安</p>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3">
        <TimeBlock
          icon={<WalkIcon size={13} />}
          label="目的地から徒歩"
          minutes={hotel.walkMinutes}
          basis={hotel.walkBasis}
        />
        <TimeBlock
          icon={<TrainIcon size={13} />}
          label="徒歩＋公共交通"
          minutes={hotel.transitMinutes}
          basis={hotel.transitBasis}
        />
      </div>

      {(hotel.nearestStation || wantedAmenities.length > 0 || hotel.highlights) && (
        <div className="mt-3 space-y-2">
          {hotel.nearestStation && (
            <p className="text-sm text-[var(--dim)]">
              最寄り：{hotel.nearestStation}
              {hotel.stationWalkMinutes !== null &&
                `から徒歩約${hotel.stationWalkMinutes}分`}
            </p>
          )}
          {wantedAmenities.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="確認できた設備">
              {wantedAmenities.map((a) => (
                <li
                  key={a}
                  className="border border-[var(--accent)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]"
                >
                  {AMENITY_LABEL.get(a) ?? a}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--dim)]">
              設備情報は資料に記載がありませんでした（情報元でご確認ください）
            </p>
          )}
          {hotel.highlights && (
            <p className="text-sm leading-relaxed text-[var(--text)]">
              {hotel.highlights}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          aria-pressed={isFavorite}
          className={`flex items-center gap-1.5 border px-3 py-2 text-sm font-medium ${
            isFavorite
              ? "border-[var(--accent-2)] text-[var(--accent-2)]"
              : "border-[var(--border)] text-[var(--text)]"
          }`}
        >
          <HeartIcon size={15} filled={isFavorite} />
          {isFavorite ? "お気に入り済み" : "お気に入り"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlan();
          }}
          className="flex items-center gap-1.5 border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)]"
        >
          <NoteIcon size={15} />
          宿泊メモに追加
        </button>
        {directionsUrl && (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)]"
          >
            <PinIcon size={15} />
            ルートを見る
          </a>
        )}
        {hotel.sourceUrl && (
          <a
            href={hotel.sourceUrl}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-ink)]"
          >
            <ExternalIcon size={15} />
            情報元で予約
          </a>
        )}
      </div>
      {hotel.priceFromJpy === null && (
        <p className="mt-2 text-xs text-[var(--dim)]">
          価格は資料に明記がなかったため、情報元ページでご確認ください。
        </p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Stay-plan modal
// ---------------------------------------------------------------------------

function PlanModal({
  hotel,
  destLabel,
  defaultCheckin,
  defaultCheckout,
  defaultGuests,
  onClose,
  onSave,
  saving,
}: {
  hotel: HotelT;
  destLabel: string;
  defaultCheckin: string;
  defaultCheckout: string;
  defaultGuests: number;
  onClose: () => void;
  onSave: (v: {
    checkin: string;
    checkout: string;
    guests: number;
    note: string;
  }) => void;
  saving: boolean;
}) {
  const [checkin, setCheckin] = useState(defaultCheckin);
  const [checkout, setCheckout] = useState(defaultCheckout);
  const [guests, setGuests] = useState(defaultGuests);
  const [note, setNote] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="宿泊メモを作成"
    >
      <div className="w-full max-w-md border border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="font-display text-lg font-semibold text-[var(--text)]">
          宿泊メモに追加
        </h3>
        <p className="mt-1 text-sm text-[var(--dim)]">
          {hotel.name}（目的地：{destLabel}）
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-sm text-[var(--text)]">
            チェックイン
            <input
              type="date"
              aria-label="チェックイン日"
              value={checkin}
              onChange={(e) => setCheckin(e.target.value)}
              className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-[var(--text)]"
            />
          </label>
          <label className="block text-sm text-[var(--text)]">
            チェックアウト
            <input
              type="date"
              aria-label="チェックアウト日"
              value={checkout}
              onChange={(e) => setCheckout(e.target.value)}
              className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-[var(--text)]"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm text-[var(--text)]">
          人数
          <select
            aria-label="人数"
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
            className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-[var(--text)]"
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}名
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm text-[var(--text)]">
          メモ
          <textarea
            aria-label="メモ"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="例：終演後に歩いて帰れる。朝食付きプランを予約する"
            className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-[var(--text)]"
          />
        </label>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--text)]"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave({ checkin, checkout, guests, note })}
            className="flex-1 bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-ink)] disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

type SearchArgs = {
  destination: string;
  mode: Mode;
  checkin?: string;
  checkout?: string;
  guests: number;
  maxWalkMinutes: number | null;
  maxTransitMinutes: number | null;
  maxPriceJpy: number | null;
  amenities: AmenityKey[];
  sort: SortKey;
};

export function App() {
  const queryClient = useQueryClient();

  const defaults = useMemo(() => {
    const inD = new Date();
    inD.setDate(inD.getDate() + 14);
    const outD = new Date();
    outD.setDate(outD.getDate() + 15);
    return { checkin: fmtDate(inD), checkout: fmtDate(outD) };
  }, []);

  const [mode, setMode] = useState<Mode>("pinpoint");
  const [destination, setDestination] = useState("");
  const [checkin, setCheckin] = useState(defaults.checkin);
  const [checkout, setCheckout] = useState(defaults.checkout);
  const [guests, setGuests] = useState(2);
  const [maxWalk, setMaxWalk] = useState<number | null>(null);
  const [maxTransit, setMaxTransit] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [amenities, setAmenities] = useState<AmenityKey[]>([]);
  const [sort, setSort] = useState<SortKey>("recommended");
  const [lastArgs, setLastArgs] = useState<SearchArgs | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<number | null>(null);
  const [planTarget, setPlanTarget] = useState<{
    hotel: HotelT;
    destLabel: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const favoritesQ = useQuery({
    queryKey: ["favorites"],
    queryFn: () => api.listFavorites({ limit: 50 }),
  });
  const plansQ = useQuery({
    queryKey: ["plans"],
    queryFn: () => api.listPlans({ limit: 50 }),
  });
  const historyQ = useQuery({
    queryKey: ["history"],
    queryFn: () => api.listHistory({ limit: 12 }),
  });

  const searchM = useMutation({
    mutationFn: (args: SearchArgs) => api.searchHotels(args),
    onSuccess: (_data, args) => {
      setLastArgs(args);
      setSelectedPlace(null);
      queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });

  const addFavM = useMutation({
    mutationFn: (v: { hotel: HotelT; destinationLabel: string }) =>
      api.addFavorite(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites"] });
      setToast("お気に入りに保存しました");
    },
  });
  const removeFavM = useMutation({
    mutationFn: (id: number) => api.removeFavorite({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites"] });
      setToast("お気に入りから外しました");
    },
  });
  const createPlanM = useMutation({
    mutationFn: (v: Parameters<typeof api.createPlan>[0]) => api.createPlan(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      setPlanTarget(null);
      setToast("宿泊メモに保存しました");
    },
  });
  const deletePlanM = useMutation({
    mutationFn: (id: number) => api.deletePlan({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });
  const deleteHistoryM = useMutation({
    mutationFn: (id: number) => api.deleteHistory({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["history"] }),
  });

  const results = searchM.data ?? null;
  const destLabel =
    results?.destination?.resolvedName ?? lastArgs?.destination ?? destination;

  const favIdByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of favoritesQ.data?.favorites ?? []) {
      map.set(`${f.name}|${f.destinationLabel}`, f.id);
    }
    return map;
  }, [favoritesQ.data]);

  const toggleFavorite = (hotel: HotelT, label: string) => {
    const id = favIdByKey.get(`${hotel.name}|${label}`);
    if (id !== undefined) removeFavM.mutate(id);
    else addFavM.mutate({ hotel, destinationLabel: label });
  };

  const currentArgs = (overrides?: Partial<SearchArgs>): SearchArgs => ({
    destination: destination.trim(),
    mode,
    checkin: checkin || undefined,
    checkout: checkout || undefined,
    guests,
    maxWalkMinutes: maxWalk,
    maxTransitMinutes: maxTransit,
    maxPriceJpy: maxPrice,
    amenities,
    sort,
    ...overrides,
  });

  const runSearch = (overrides?: Partial<SearchArgs>) => {
    const args = currentArgs(overrides);
    if (!args.destination) {
      setToast("目的地を入力してください");
      return;
    }
    searchM.mutate(args);
  };

  const rerunHistory = (h: {
    query: string;
    mode: Mode;
    checkin: string | null;
    checkout: string | null;
    guests: number;
  }) => {
    setDestination(h.query);
    setMode(h.mode);
    if (h.checkin) setCheckin(h.checkin);
    if (h.checkout) setCheckout(h.checkout);
    setGuests(h.guests);
    searchM.mutate(
      currentArgs({
        destination: h.query,
        mode: h.mode,
        checkin: h.checkin ?? undefined,
        checkout: h.checkout ?? undefined,
        guests: h.guests,
      }),
    );
  };

  const toggleAmenity = (key: AmenityKey) => {
    setAmenities((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  // Map place indices: 0 = destination, then hotels with coordinates in order.
  const placeIndexByHotel = useMemo(() => {
    const map = new Map<number, number>();
    if (!results) return map;
    let idx = 1;
    results.hotels.forEach((h, i) => {
      if (h.lat !== null && h.lon !== null) {
        map.set(i, idx);
        idx += 1;
      }
    });
    return map;
  }, [results]);

  const hotelIndexByPlace = useMemo(() => {
    const map = new Map<number, number>();
    placeIndexByHotel.forEach((place, hotelIdx) => map.set(place, hotelIdx));
    return map;
  }, [placeIndexByHotel]);

  const selectedHotelIndex =
    selectedPlace !== null && selectedPlace > 0
      ? (hotelIndexByPlace.get(selectedPlace) ?? null)
      : null;

  useEffect(() => {
    if (selectedHotelIndex !== null) {
      document
        .getElementById(`hotel-card-${selectedHotelIndex}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedHotelIndex]);

  const chipCls = (active: boolean) =>
    `border px-3 py-1.5 text-sm ${
      active
        ? "border-[var(--accent)] bg-[var(--accent)] font-semibold text-[var(--accent-ink)]"
        : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
    }`;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />

      {/* ---------- Hero + search ---------- */}
      <header className="mx-auto max-w-5xl px-4 pt-6 md:pt-10">
        <div className="grid items-center gap-5 md:grid-cols-[1.2fr_1fr]">
          <div>
            <h1 className="font-display text-3xl leading-tight font-bold md:text-4xl">
              会場のそばに、
              <br />
              歩いて帰れる宿を。
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)] md:text-base">
              イベント会場の住所をピンポイントで、旅先はエリアで。目的地から「徒歩で何分」「徒歩＋公共交通で何分」と、シャワーや朝食などの設備で絞り込んでホテルを探せます。
            </p>
          </div>
          <img
            src={heroImg}
            alt="夕暮れのドーム型スタジアムのそばのホテルへ、電車と徒歩で向かう旅人たちのイラスト"
            className="hidden w-full border border-[var(--border)] object-cover md:block"
            width={960}
            height={640}
          />
        </div>

        <form
          className="mt-6 border border-[var(--border)] bg-[var(--surface)] p-4 md:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <div
            className="grid grid-cols-2 border border-[var(--border)]"
            role="tablist"
            aria-label="目的地の指定方法"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pinpoint"}
              onClick={() => setMode("pinpoint")}
              className={`px-3 py-2.5 text-sm font-semibold ${
                mode === "pinpoint"
                  ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "text-[var(--dim)]"
              }`}
            >
              ピンポイント指定
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "area"}
              onClick={() => setMode("area")}
              className={`px-3 py-2.5 text-sm font-semibold ${
                mode === "area"
                  ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "text-[var(--dim)]"
              }`}
            >
              エリア指定
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
            {mode === "pinpoint"
              ? "会場名や住所をそのまま入力してください。例：東京ドーム／東京都文京区後楽1-3-61／幕張メッセ"
              : "街・駅・地域の名前で広く探します。例：新宿／大阪 梅田／京都駅周辺／札幌"}
          </p>

          <label className="mt-3 block">
            <span className="sr-only">目的地</span>
            <div className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] px-3 focus-within:border-[var(--accent)]">
              <PinIcon size={18} />
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={
                  mode === "pinpoint" ? "会場名・住所を入力" : "エリア・駅名を入力"
                }
                aria-label="目的地"
                className="w-full bg-transparent py-3 text-base outline-none placeholder:text-[var(--dim)]"
              />
            </div>
          </label>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="block text-xs text-[var(--dim)]">
              チェックイン
              <input
                type="date"
                aria-label="チェックイン日"
                value={checkin}
                onChange={(e) => setCheckin(e.target.value)}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]"
              />
            </label>
            <label className="block text-xs text-[var(--dim)]">
              チェックアウト
              <input
                type="date"
                aria-label="チェックアウト日"
                value={checkout}
                onChange={(e) => setCheckout(e.target.value)}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]"
              />
            </label>
            <label className="col-span-2 block text-xs text-[var(--dim)] sm:col-span-1">
              人数
              <select
                aria-label="人数"
                value={guests}
                onChange={(e) => setGuests(Number(e.target.value))}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}名
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="flex items-center gap-1.5 text-sm font-semibold">
              <WalkIcon size={15} /> 目的地から徒歩
            </legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WALK_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={maxWalk === o.value}
                  onClick={() => setMaxWalk(o.value)}
                  className={chipCls(maxWalk === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="flex items-center gap-1.5 text-sm font-semibold">
              <TrainIcon size={15} /> 徒歩＋公共交通
            </legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TRANSIT_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={maxTransit === o.value}
                  onClick={() => setMaxTransit(o.value)}
                  className={chipCls(maxTransit === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="text-sm font-semibold">設備で絞り込む</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {AMENITIES.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  aria-pressed={amenities.includes(a.key)}
                  onClick={() => toggleAmenity(a.key)}
                  className={chipCls(amenities.includes(a.key))}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-[var(--dim)]">
              設備は検索資料で裏付けが取れたホテルを優先表示します。「シャワーのみ」と「バスタブ・湯船」は別々に選べます。
            </p>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block text-xs text-[var(--dim)]">
              予算上限（1泊）
              <select
                aria-label="予算上限"
                value={maxPrice === null ? "" : String(maxPrice)}
                onChange={(e) =>
                  setMaxPrice(e.target.value === "" ? null : Number(e.target.value))
                }
                className="mt-1 block border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]"
              >
                {PRICE_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value === null ? "" : o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={searchM.isPending}
              className="flex flex-1 items-center justify-center gap-2 bg-[var(--accent-2)] px-5 py-3 text-base font-bold text-white disabled:opacity-60 sm:flex-none sm:px-10"
            >
              <SearchIcon size={18} />
              {searchM.isPending ? "検索中…" : "ホテルを検索"}
            </button>
          </div>
          {searchM.isPending && (
            <p className="mt-3 flex items-center gap-2 text-sm text-[var(--dim)]">
              <ClockIcon size={15} />
              Webで最新のホテル情報を確認しています。30秒ほどかかることがあります。
            </p>
          )}
          {searchM.isError && (
            <p className="mt-3 border border-[var(--accent-2)] px-3 py-2 text-sm text-[var(--accent-2)]">
              検索に失敗しました。少し時間をおいて、もう一度お試しください。
            </p>
          )}
        </form>

        {(historyQ.data?.history.length ?? 0) > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold tracking-wide text-[var(--dim)]">
              最近の検索
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {historyQ.data?.history.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center border border-[var(--border)] bg-[var(--surface)]"
                >
                  <button
                    type="button"
                    onClick={() => rerunHistory(h)}
                    className="px-3 py-1.5 text-sm text-[var(--text)]"
                    aria-label={`「${h.query}」で再検索`}
                  >
                    {h.query}
                    <span className="ml-1.5 text-xs text-[var(--dim)]">
                      {h.mode === "pinpoint" ? "ピンポイント" : "エリア"}・
                      {h.resultCount}件
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteHistoryM.mutate(h.id)}
                    aria-label={`検索履歴「${h.query}」を削除`}
                    className="px-2 py-1.5 text-[var(--dim)]"
                  >
                    <TrashIcon size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {/* ---------- Results ---------- */}
      <main className="mx-auto max-w-5xl px-4 pb-16">
        {results && (
          <section aria-label="検索結果" className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-[var(--accent)] pb-3">
              <div>
                <h2 className="font-display text-2xl font-bold">
                  {results.destination?.resolvedName ?? lastArgs?.destination}
                  <span className="ml-2 text-base font-medium text-[var(--dim)]">
                    のホテル {results.hotels.length}件
                  </span>
                </h2>
                {results.destination && (
                  <p className="mt-1 text-xs text-[var(--dim)]">
                    目的地：{results.destination.displayAddress}
                  </p>
                )}
                <p className="mt-1 text-xs text-[var(--dim)]">
                  {new Date(results.searchedAt).toLocaleString("ja-JP")} 時点のWeb検索結果
                  {results.totalFound > results.hotels.length &&
                    `（全${results.totalFound}件から条件で絞り込み）`}
                  {results.excludedByTimeFilter > 0 &&
                    ` ・ 時間条件で${results.excludedByTimeFilter}件を除外`}
                </p>
              </div>
              <label className="block text-xs text-[var(--dim)]">
                並び替え
                <select
                  aria-label="並び替え"
                  value={sort}
                  onChange={(e) => {
                    const v = e.target.value as SortKey;
                    setSort(v);
                    if (lastArgs) runSearch({ sort: v });
                  }}
                  className="mt-1 block border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]"
                >
                  <option value="recommended">おすすめ順</option>
                  <option value="walk">徒歩が近い順</option>
                  <option value="transit">徒歩＋交通が早い順</option>
                  <option value="price">価格が安い順</option>
                  <option value="rating">評価が高い順</option>
                </select>
              </label>
            </div>

            {results.amenityFilterNote && (
              <p className="mt-3 border border-[var(--gold)] px-3 py-2 text-sm text-[var(--text)]">
                {results.amenityFilterNote}
              </p>
            )}

            {results.destination && results.hotels.length > 0 && (
              <div className="mt-4">
                <MapView
                  destination={results.destination}
                  hotels={results.hotels}
                  selectedPlaceIndex={selectedPlace}
                  onSelectPlace={setSelectedPlace}
                />
              </div>
            )}

            {results.hotels.length === 0 ? (
              <div className="mt-6 border border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center">
                <p className="font-display text-lg font-semibold">
                  条件に合うホテルが見つかりませんでした
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--dim)]">
                  徒歩・交通の上限を緩める、設備の選択を減らす、目的地の表記を変える（駅名や区名など）といった調整でもう一度お試しください。
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {results.hotels.map((hotel, i) => (
                  <div key={`${hotel.name}-${i}`} id={`hotel-card-${i}`}>
                    <HotelCard
                      hotel={hotel}
                      pinNumber={placeIndexByHotel.get(i) ?? null}
                      highlighted={selectedHotelIndex === i}
                      isFavorite={
                        favIdByKey.get(`${hotel.name}|${destLabel}`) !== undefined
                      }
                      destCoords={
                        results.destination
                          ? {
                              lat: results.destination.lat,
                              lng: results.destination.lon,
                            }
                          : null
                      }
                      destLabel={destLabel}
                      onToggleFavorite={() => toggleFavorite(hotel, destLabel)}
                      onPlan={() => setPlanTarget({ hotel, destLabel })}
                      onSelect={() => {
                        const p = placeIndexByHotel.get(i);
                        if (p !== undefined) setSelectedPlace(p);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 text-xs leading-relaxed text-[var(--dim)]">
              徒歩・徒歩＋公共交通の時間は、資料に明記がある場合は「掲載情報」、ない場合は目的地との距離から計算した「目安」です。価格は検索時点の目安で、宿泊日・プランで変わります。予約の確定は各ホテルの情報元ページで行ってください。
            </p>
            {results.sources.length > 0 && (
              <details className="mt-3 border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold">
                  情報元（{results.sources.length}件）
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {results.sources.map((s) => (
                    <li key={s.url} className="text-sm">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener"
                        className="text-[var(--accent)] underline"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        {/* ---------- Favorites & plans ---------- */}
        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          <section aria-label="お気に入り">
            <h2 className="font-display border-b-2 border-[var(--accent)] pb-2 text-xl font-bold">
              お気に入り
              <span className="ml-2 text-sm font-medium text-[var(--dim)]">
                {favoritesQ.data?.favorites.length ?? 0}件
              </span>
            </h2>
            {(favoritesQ.data?.favorites.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
                まだお気に入りはありません。検索結果のホテルで「お気に入り」を押すと、ここに保存されます。
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {favoritesQ.data?.favorites.map((f) => (
                  <div key={f.id}>
                    <p className="mb-1 text-xs text-[var(--dim)]">
                      目的地：{f.destinationLabel} ／{" "}
                      {new Date(f.createdAt).toLocaleDateString("ja-JP")} 保存
                    </p>
                    <HotelCard
                      hotel={f.hotel}
                      pinNumber={null}
                      highlighted={false}
                      isFavorite
                      destCoords={null}
                      destLabel={f.destinationLabel}
                      onToggleFavorite={() => removeFavM.mutate(f.id)}
                      onPlan={() =>
                        setPlanTarget({
                          hotel: f.hotel,
                          destLabel: f.destinationLabel,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-label="宿泊メモ">
            <h2 className="font-display border-b-2 border-[var(--accent)] pb-2 text-xl font-bold">
              宿泊メモ
              <span className="ml-2 text-sm font-medium text-[var(--dim)]">
                {plansQ.data?.plans.length ?? 0}件
              </span>
            </h2>
            {(plansQ.data?.plans.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
                候補のホテルに日程とメモを付けて保存できます。検索結果やお気に入りの「宿泊メモに追加」からどうぞ。
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {plansQ.data?.plans.map((p) => (
                  <li
                    key={p.id}
                    className="border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-base font-semibold">
                          {p.hotelName}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--dim)]">
                          目的地：{p.destinationLabel}
                        </p>
                        <p className="tnum mt-1 text-sm">
                          {p.checkin ? fmtDateJa(p.checkin) : "日付未定"}
                          {p.checkout && ` 〜 ${fmtDateJa(p.checkout)}`} ・{" "}
                          {p.guests}名
                        </p>
                        {p.note && (
                          <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap">
                            {p.note}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => deletePlanM.mutate(p.id)}
                        aria-label={`宿泊メモ「${p.hotelName}」を削除`}
                        className="p-1 text-[var(--dim)]"
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                    {p.sourceUrl && (
                      <a
                        href={p.sourceUrl}
                        target="_blank"
                        rel="noopener"
                        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] underline"
                      >
                        <ExternalIcon size={13} />
                        情報元で予約に進む
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      {planTarget && (
        <PlanModal
          hotel={planTarget.hotel}
          destLabel={planTarget.destLabel}
          defaultCheckin={checkin}
          defaultCheckout={checkout}
          defaultGuests={guests}
          onClose={() => setPlanTarget(null)}
          saving={createPlanM.isPending}
          onSave={(v) =>
            createPlanM.mutate({
              hotelName: planTarget.hotel.name,
              destinationLabel: planTarget.destLabel,
              checkin: v.checkin || null,
              checkout: v.checkout || null,
              guests: v.guests,
              note: v.note,
              sourceUrl: planTarget.hotel.sourceUrl,
            })
          }
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed right-4 bottom-4 left-4 z-50 mx-auto max-w-sm bg-[var(--accent)] px-4 py-3 text-center text-sm font-semibold text-[var(--accent-ink)] shadow-lg sm:left-auto"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
