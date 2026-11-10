# セットアップガイド — clone しただけでは動かない理由と、動かすための手順

このリポジトリは、Muse の「スペース」（TypeScript スペース、`space.json` の slug: `hoteruyu-yue-apuri`）の**ソースコードのミラー**です。
スペースは Muse のランタイム上で動く前提で作られているため、**このリポジトリを clone しただけでは、そのまま他の環境では動きません。**
このガイドでは「何が含まれていないか」「どこを差し替えれば動くか」をまとめます。

---

## 1. 結論：不足しているもの一覧

| # | 不足しているもの | 影響 | 対処 |
|---|---|---|---|
| 1 | `@hatch/space-sdk` 本体 | `bun install` が失敗する（最重要） | §4-A / §4-B を参照 |
| 2 | DB ファイル `app.db` | お気に入り・履歴・宿泊メモが保存できない | §5 の手順で空の DB を再作成 |
| 3 | ヒーロー画像 `client/src/assets/hotel-hero.webp` | クライアントのビルドが失敗する | §6 を参照 |
| 4 | ランタイム提供の `ctx.*` サービス | ホテル検索・DB・推論が動かない | §7 の対応表で自前実装に差し替え |
| 5 | ビルド成果物 `client/dist/`、`server/dist/` | 配信する HTML / JS がない | ビルドで再生成（ただし #1 が前提） |
| 6 | `node_modules/` | 依存モジュールがない | `bun install` で再生成（ただし #1 が前提） |

`.gitignore` で除外されているもの：`node_modules/`、`client/dist/`、`client/dist-cvm/`、`server/dist/`、`app.db*`、`*.tsbuildinfo`、`*.webp`

---

## 2. なぜ `@hatch/space-sdk` が無いと詰むのか

`package.json` の依存はこうなっています。

```json
"@hatch/space-sdk": "file:/opt/hatch/skills/spaces/ts-runtime/dist/space-sdk.tgz"
```

つまり SDK は npm レジストリではなく、**Muse 環境内にあるローカルファイル**を指しています。
Muse の外ではこのパスが存在しないため、`bun install` が失敗し、以下すべてが止まります。

SDK を使っている場所：

| ファイル | SDK の利用 |
|---|---|
| `server/src/actions.ts` | `defineAction`、`z`、`ActionsModule` / `Ctx` 型 |
| `client/src/api.ts` | `createActionClient`（`./actions` へ POST する型付き RPC クライアント） |
| `client/src/main.tsx` | `spaceQueryClient` |
| `client/src/App.tsx` | `SafeAreaTopScrim` |
| `client/build.mjs` | `buildClient`（`@hatch/space-sdk/build`、バンドル処理一式） |

---

## 3. リポジトリ構成

```
.
├── space.json            # スペース定義（runtime: typescript / platformVersion: 28 / entry: client/dist/index.html）
├── package.json          # Bun プロジェクト定義（packageManager: bun@1.3.10）
├── bun.lock / bunfig.toml
├── client/
│   ├── index.html
│   ├── build.mjs         # SDK の buildClient を呼ぶだけの薄いラッパー
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx      # エントリ（data-generated-space-root 要素にマウント）
│       ├── App.tsx       # UI 本体
│       ├── api.ts        # サーバーアクションへの型付きクライアント
│       ├── theme.css
│       ├── map_helpers.mjs / .d.mts
│       └── assets/
│           ├── hatch-maps.js / hatch-maps.css  # 地図ランタイム（同梱済み、§8）
│           ├── media-generation-hotel-hero-1794263565.json  # 画像の生成メタ情報のみ
│           └── hotel-hero.webp   # ★ リポジトリには含まれていない（§6）
├── server/
│   ├── tsconfig.json
│   └── src/
│       ├── actions.ts    # サーバーアクション本体（§7）
│       └── schema.ts     # Drizzle スキーマ（§5）
└── drizzle/              # SQLite マイグレーション
    ├── 0001_initial.sql
    ├── 0002_hotel_tables_replace_entries.sql
    └── meta/_journal.json
```

前提バージョン（`package.json` より）：Bun 1.3.10、React 19.2.5、drizzle-orm 0.45.2、TypeScript 5.6.3、@tanstack/react-query 5.100.10、zod 4.4.3。

---

## 4. 動かし方

### 4-A. Muse のスペースとして復元する（確実な方法）

SDK も DB も Muse のランタイムが用意するため、この方法が一番素直です。

1. Muse 上で TypeScript スペースを用意し、このリポジトリのソースをそのスペースのソース一式として配置する（`space.json` の slug / runtime を維持）。
2. ヒーロー画像（§6）を元のスペースから取り戻して `client/src/assets/hotel-hero.webp` に置く。
3. Muse のビルド／配置フローでビルドする（`bun run build` を手で回して公開する形式ではありません。スペースのビルドは Muse 側の仕組みで行います）。
4. DB はランタイムが空の `app.db` を作り、`drizzle/` のマイグレーションが適用されれば、お気に入り等は空の状態から使い始められます（過去のデータは移行されません、§5）。

### 4-B. Muse の外（独自環境）へ移植する

移植作業として、最低限次の差し替えが必要です。目安として「UI（React 部分）はほぼそのまま使えるが、サーバーとビルドは SDK 前提を外す作業になる」と考えてください。

1. **依存の解決**
   - `@hatch/space-sdk` の `file:` 依存を外す。`client/build.mjs` は SDK の `buildClient` 前提なので、Vite 等の通常のバンドラに置き換える。
   - `client/src/main.tsx` の `spaceQueryClient` は通常の `QueryClient`（@tanstack/react-query）に、`SafeAreaTopScrim` は自前のコンポーネントか削除に置き換える。
2. **アクション層の実装**
   - `client/src/api.ts` の `createActionClient` は「`./actions` へ `{action, args}` を POST する」クライアントです。自前の HTTP サーバー（Hono / Express 等）で同じ形のエンドポイントを用意するか、`api.ts` 自体を通常の fetch クライアントに書き換える。
   - `server/src/actions.ts` の `defineAction` は zod スキーマ付きの関数定義です。各アクションを通常の関数／ルートとして切り出す。
3. **DB の用意**：§5 の通り SQLite ファイルを作り、Drizzle から接続する（`ctx.db` の差し替え、§7）。
4. **`ctx.*` の差し替え**：§7 の対応表の通り、Web 検索と推論（LLM）を自前の API に置き換える。ここが移植の山場です（API キーが必要になります）。
5. **画像の用意**：§6。
6. **動作確認**：検索（`searchHotels`）、お気に入り追加／削除、履歴、宿泊メモ作成まで一通り確認する。

アクション一覧（`server/src/actions.ts`）：`searchHotels`、`listFavorites`、`addFavorite`、`removeFavorite`、`listHistory`、`deleteHistory`、`listPlans`、`createPlan`、`deletePlan` の 9 つ。

---

## 5. DB（`app.db`）について

- 実データの入った `app.db` は**意図的にリポジトリへ上げていません**（利用者のお気に入り・検索履歴・宿泊メモというユーザーデータのため、`.gitignore` 対象）。
- スキーマ定義は `server/src/schema.ts`、マイグレーションは `drizzle/` にあります。テーブルは次の 3 つです。
  - `favorites`（お気に入り：ホテル情報の JSON スナップショットを含む）
  - `search_history`（検索履歴）
  - `stay_plans`（宿泊メモ）
- 再作成手順：空の SQLite ファイルを用意し、**`0001_initial.sql` → `0002_hotel_tables_replace_entries.sql` の順に両方**を適用してください。
  - 注意：`0001` は旧形式の `entries` テーブルを作るだけの初期マイグレーションで、`0002` がそれを削除して上記 3 テーブルを作ります。`0002` だけを適用しても動きますが、履歴（`drizzle/meta/_journal.json`）と揃えるなら両方を順に適用するのが正規手順です。
- ホテル検索結果そのものは DB に保存されません（検索のたびに外部から取得する設計）。DB の中身は空からで問題ありません。

---

## 6. 画像（`hotel-hero.webp`）について

- `client/src/App.tsx` が `import heroImg from "./assets/hotel-hero.webp"` で読み込んでいますが、このファイルはバイナリのため GitHub 連携の制約でリポジトリに含まれていません（`*.webp` は `.gitignore` 対象）。**このままだと import が解決できずビルドが失敗します。**
- 対処はどちらか：
  1. 元のスペース所持者から `client/src/assets/hotel-hero.webp`（約 517 KB）の実ファイルをもらって配置する。
  2. 自前の画像を用意して同名で置く、または `App.tsx` の import 先を変更する（生成メタ情報は `client/src/assets/media-generation-hotel-hero-1794263565.json` に残っています）。
- リポジトリ外の話として、スペースのアイコン画像 `icon.webp` も同様に含まれていませんが、アプリの実行には不要です。

---

## 7. ランタイム依存（`ctx.*`）の対応表

`server/src/actions.ts` は、Muse のスペースランタイムが注入する `ctx` に依存しています。リポジトリには `ctx` の実装は含まれません。

| 利用箇所 | 役割 | 独自環境での代替 |
|---|---|---|
| `ctx.db<typeof schema>()` | Drizzle 経由の SQLite アクセス | `drizzle-orm` + `bun:sqlite` 等で自前の DB 接続を用意 |
| `ctx.tool.web_search(q)` | ホテル発見のための Web 検索 | 検索 API（Brave / Tavily / SerpAPI 等）。要 API キー |
| `ctx.inference.complete(...)` | 検索結果からホテル情報（価格・評価・設備など）を zod スキーマで構造化抽出 | LLM API（構造化出力）。要 API キー |
| `ctx.invalidateQueries()` | クライアント側キャッシュの無効化 | React Query の `queryClient.invalidateQueries` 相当を自前で |

コード内で直接叩いている外部サービス（API キー不要、ネット接続のみ）：

- **Nominatim**（OpenStreetMap）：目的地とホテルのジオコーディング。`User-Agent: MuseHotelSearch/1.0` を送っています。利用時は [Nominatim の利用ポリシー](https://operations.osmfoundation.org/policies/nominatim/)（リクエスト頻度など）を守り、User-Agent は自分のものに変えてください。
- **Photon**（photon.komoot.io）：ホテルジオコーディングの第一候補。目的地に近い候補を優先し、30 km 以上離れた結果は除外しています。

API キーや秘密情報はコード内に含まれていません（`.env` 等もありません）。移植先で検索 API / LLM のキーを用意する場合は、環境変数で渡し、リポジトリにコミットしないでください。

---

## 8. 地図について

- 地図ランタイム `client/src/assets/hatch-maps.js` / `hatch-maps.css` は**リポジトリに含まれています**（`globalThis.HatchMaps` を提供し、`client/src/map_helpers.mjs` がラップしています）。
- ただし地図タイルの取得にはネットワーク接続が必要です。地図が表示できない環境では、一覧表示にフォールバックする設計になっています。

---

## 9. コマンド

`package.json` の scripts（いずれも SDK が揃っている前提）：

```bash
bun install        # 依存インストール（§2 の理由で Muse 外では失敗する）
bun run typecheck  # client / server の型チェック
bun run build      # build:server（actions を bun build）と build:client の一括
```

---

## 10. トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `bun install` で `@hatch/space-sdk` が見つからない | 想定内です（§2）。4-A で復元するか、4-B の差し替えを行ってください |
| ビルドで `hotel-hero.webp` が解決できない | §6 の通り画像を配置するか import を差し替えてください |
| お気に入り／履歴が保存されない | DB が未作成です。§5 の通りマイグレーションを適用してください |
| 検索結果が 0 件になる | `ctx.tool.web_search` / `ctx.inference` 相当が未実装か、検索 API / LLM のキーが未設定の可能性があります（§7） |
| 地図だけ出ない | タイル取得のネットワークを確認してください。一覧表示は地図なしでも使えます（§8） |

---

## 11. このリポジトリの同期について

- このリポジトリは、Muse 上のスペースの変更に追随して随時コミット＆プッシュされるミラーです（テキストファイルのみ。バイナリ・DB・ビルド成果物は含まれません）。
- そのため、独自環境向けの移植作業は**ブランチを切って**行うのがおすすめです。`main` へ直接手を入れると、次の同期プッシュと競合する場合があります。
- 仕様・データ取得方針の詳細は `DATA-PLAN.md` を参照してください。
