# Data Plan

## Context provenance
- `イベント会場の住所をピンポイントで入力したり、あるいは少し幅広く旅先を領域指定するとホテルを検索してくれるサービス` (prior user statement; drives the two search modes: ピンポイント指定 = venue name / exact address, エリア指定 = city / neighborhood / region)
- `目的地から徒歩何分か、徒歩+公共交通機関で何分か、ホテルの設備(シャワー付きかなど)が任意に選択できるように` (prior user statement; drives per-hotel 徒歩時間 + 徒歩+公共交通の所要時間 display and the amenity multi-select filter, with シャワーのみ / バスタブ付き as separate options)
- No external context applied beyond the verbatim request; UI language is Japanese to match the request.

## Tested sources
### Nominatim (OpenStreetMap geocoding) — destination resolution + hotel fallback
**Used by**: `searchHotels` action (fetch from server)
**Test command**: `curl -s "https://nominatim.openstreetmap.org/search?q=東京ドーム&format=json&limit=2" -H "User-Agent: MuseHotelProbe/1.0"`
**Sample output**: `lat 35.7055706, lon 139.7519705, name 東京ドーム` — correct pinpoint (the built-in map.geocode probe returned a wrong result for the same query). Single hotel query `東京ドームホテル` also resolves correctly (35.7036, 139.7534, tourism=hotel).
**Processing**: Destination anchor = first result. Hotel fallback only, called sequentially (Nominatim's ~1 req/s policy made parallel calls return nothing — verified in the first sandbox search where all 12 parallel hotel geocodes came back null). Walking minutes = haversine ÷ 80m/min with ×1.25 road factor; transit minutes = estimate model (access + wait + rail ~28km/h + egress), always labeled 目安.

### Photon (photon.komoot.io, OpenStreetMap data) — primary hotel geocoding
**Used by**: `searchHotels` action (fetch from server)
**Test command**: `curl -s "https://photon.komoot.io/api/?q=東京ドームホテル&limit=1"`
**Sample output**: Feature with coordinates [139.7534916, 35.7036411], name 東京ドームホテル — same OSM record as Nominatim. KOKO HOTEL 後楽園 without bias matched a wrong Osaka branch, so requests carry the destination lat/lon bias and results >30 km from the destination are rejected.
**Processing**: Parallel per-hotel lookups with destination bias + 30 km sanity check; misses fall back to sequential Nominatim (budget 4). Hotels with no coordinates stay list-only, never invented.

### ctx.tool.web_search — live hotel discovery
**Used by**: `searchHotels` action
**Test command**: probe-ctx snippet `await ctx.tool.web_search("東京ドーム ホテル")` (string argument; object argument fails), plus a full sandbox `searchHotels` invocation.
**Sample output**: Sandbox run for 東京ドーム (pinpoint) returned 12 real hotels (KOKO HOTEL 後楽園 徒歩2分, the b 水道橋 徒歩8分, エドモント 徒歩10分, お茶の水ホテルジュラク 徒歩＆電車10分, ドーミーイン後楽園 大浴場…) with verbatim source URLs (JR Central, Trip.com, blog roundups). Queries: 「<destination> ホテル おすすめ」「<destination> ホテル 徒歩|駅近」「<destination> ホテル 宿泊料金 評価 口コミ」plus an amenity query when amenities are selected.
**Processing**: ctx.inference (Zod schema — probe confirmed a `schema` is required) extracts per-hotel name, price-from, rating/scale, review count, stated walk/transit minutes, distance, nearest station, evidenced amenities, source index. Source URLs are validated against the actual result URL set. Amenities without evidence are 不明, never claimed absent; amenity filtering keeps hotels with positive evidence and explains itself in the response.

### Overpass API — REJECTED
**Test command**: POST `https://overpass-api.de/api/interpreter` hotels around Tokyo Dome
**Why rejected**: Query did not return within the probe window; too unreliable for an interactive search action.

## Imagery
- Hotel rows are intentionally text-forward (name, rating, times, amenity chips, price目安) with monogram/number tiles — per-hotel photos cannot be honestly owned for arbitrary user-searched destinations at runtime, so no fake or hotlinked hotel photos ship.
- One build-time generated illustration (gouache travel artwork: stadium dome, hotel, train, travelers; no text) in client/src/assets/hotel-hero.webp, imported by the client.
- Interactive map uses the bundled Meta hatch-maps runtime, side-effect-imported into the single client bundle (it assigns globalThis.HatchMaps; a separate file asset breaks the one-bundle rule — verified by a failed build), with hatch-maps.css imported alongside map_helpers.mjs copied into client/src. Destination + geocoded hotels plotted; list-only fallback when the control is unavailable.

## Long-term data behavior
- **Refresh policy**: Hotel results are live per search (web_search at action call time), never cached as permanent inventory; prices shown as 目安 with source links and a searched-at timestamp. No cron refresh.
- **Growth**: favorites, search history, and stay-plan memos are user-created rows in ctx.db; history capped by listing limit, all deletable in UI.
- **Ordering**: Results sorted by user-chosen key (おすすめ / 徒歩が近い / 交通が早い / 価格が安い / 評価); favorites and history newest first.
- **Time semantics**: Check-in/out dates are user-entered local dates stored as date strings; searched_at stored as instant and rendered viewer-local.
