# 画像生成アプリ MVP 基本設計書（完全ローカル構成）v5

> v1(Geminiによる初期設計)からの変更点は各セクション末尾に **[変更]** として明記。
> v2: `Imagen 3`(廃止直前)からNano Banana系への置き換え、4K画像生成・Google AI Pro特典の活用を反映。
> v3: 画像生成フローを「4枚プレビュー生成 → 選択 → 4K本番生成」の2段階に変更。
> v4: 実務利用を見据えた認証・レート制限・入力バリデーションを追加。MVP環境構築の段階からコンテナ化(Docker)を導入(当面の実行はローカル)。
> v5: 姉妹リポジトリ（asami.tokyo, spira-base）の設計パターンを参考に、DB設計へAlembicマイグレーション・FK制約・インデックス・Enum化を追加。

## 1. プロジェクト概要

Gemini APIを統合的に活用し、短いテキスト入力から高品質な「実写表現限定・4K」の画像を生成するローカルWebアプリケーション。バックエンドとフロントエンドを分離し、画像と履歴をローカルに保存する。

## 2. 技術スタック

- フロントエンド: Next.js (App Router), React, TypeScript, Tailwind CSS
- バックエンド: FastAPI, Python, SQLAlchemy (または SQLModel), Uvicorn
- データベース: SQLite (ファイル名: `history.db`)、Alembic（マイグレーション管理）
- ファイルストレージ: ローカルディレクトリ (`backend/static/images/`)
- 外部API: Gemini API (`google-genai` SDK, APIキー認証)
  - プロンプト拡張用: `gemini-2.5-flash` または `gemini-3.5-flash-lite`(無料枠で運用)
  - 画像生成用: `gemini-3-pro-image`(Nano Banana Pro)— 4K出力・高い指示追従性を優先して採用
- レート制限: `slowapi`（FastAPI向け）
- 実行環境: Docker / docker-compose（MVP環境構築の段階から導入。当面はローカル実行のみ）

**[変更]**
- `Imagen 3` → `gemini-3-pro-image`(Nano Banana Pro)に変更。Imagen系は廃止直前のため使用不可。
- `Gemini 1.5 Flash` → `gemini-2.5-flash` / `gemini-3.5-flash-lite`に変更。旧モデルは提供終了。
- 画像生成モデルはFlash系(`gemini-3.1-flash-image`等)も4K対応だが、実写限定という制約の遵守精度と品質を優先しProモデルを選定。コストを抑えたい場合はFlash系への切替も選択肢として残す。
- （v4）Docker / docker-compose、レート制限ライブラリを追加。実務利用を見据え、ローカル実行でもコンテナー前提の構成にする。

## 3. ディレクトリ構成（想定）

```
project-root/
├── docker-compose.yml         # backend/frontendをローカルで起動するための定義
├── backend/                   # FastAPIバックエンド
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── main.py                # FastAPIエントリーポイント
│   ├── database.py            # SQLite接続・セッション管理
│   ├── models.py               # SQLAlchemyスキーマ定義
│   ├── schemas.py              # Pydanticモデル (リクエスト/レスポンス)
│   ├── services.py             # Gemini API呼び出し・画像保存ロジック
│   ├── auth.py                 # 認証依存関数(共有トークン検証)
│   ├── static/
│   │   └── images/             # 生成された画像の保存先 (StaticFilesで配信、named volumeで永続化)
│   ├── history.db              # SQLiteデータベースファイル(named volumeで永続化)
│   ├── requirements.txt        # 依存パッケージ
│   └── .env                    # GEMINI_API_KEY, APP_API_TOKEN 等を保存
└── frontend/                   # Next.jsフロントエンド
    ├── Dockerfile
    ├── .dockerignore
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx        # メインUI（入力フォーム＆最新結果表示）
    │   │   ├── layout.tsx
    │   │   └── api/            # (必要に応じて) Next.js側のBFF ※要否は要検討、下記参照
    │   └── components/         # UIコンポーネント (履歴ギャラリー等)
    ├── package.json
    └── .env_local               # NEXT_PUBLIC_API_URL=http://localhost:8000 など
```

**[変更]**
- （v4）`docker-compose.yml`、各サービスの`Dockerfile`・`.dockerignore`、認証用の`backend/auth.py`を追加。

## 4. データベース設計（SQLite / Alembicでマイグレーション管理）

> [asami.tokyo](https://github.com/asamiile/asami.tokyo)（Drizzle）、[spira-base](https://github.com/asamiile/spira-base)（SQLAlchemy + Alembic）の設計パターンを参考に、マイグレーション管理・FK制約・インデックスを追加。

画像生成を「プレビュー（4枚・低解像度）→選択→本番（1枚・4K）」の2段階に分けるため、`sessions`と`preview_images`の2テーブル構成とする。

### テーブル名: `sessions`（1リクエスト=1セッション、本番結果はここに持つ）

| カラム名 | 型 | 説明 |
|---|---|---|
| id | Integer (PK) | 一意のID（自動採番） |
| original_prompt | String | ユーザーが入力した元の短いテキスト |
| enhanced_prompt | Text | Geminiによって拡張された英語プロンプト |
| selected_preview_id | Integer (FK → `preview_images.id`, `ondelete="SET NULL"`, nullable) | 選択された`preview_images.id`。未選択の間はNULL |
| final_image_path | String (nullable) | 4K本番画像の相対パス。未生成/失敗時はNULL |
| final_status | Enum(`"success"`, `"failed"`)（nullable） | 本番生成の状態。未実行はNULL |
| error_message | Text (nullable) | プレビューまたは本番生成の失敗内容 |
| resolution | String | 本番生成の解像度（デフォルト `"4K"`） |
| created_at | DateTime (timezone-aware, `server_default=func.now()`, **index**) | セッション作成日時（プレビュー生成時）。`GET /api/history`の降順ソートに使うため要インデックス |
| finalized_at | DateTime (nullable) | 本番生成完了日時 |

### テーブル名: `preview_images`（1セッション=4件）

| カラム名 | 型 | 説明 |
|---|---|---|
| id | Integer (PK) | 一意のID（自動採番） |
| session_id | Integer (FK → `sessions.id`, `ondelete="CASCADE"`, **index**) | セッション削除時にプレビューも道連れで削除する（親なしのプレビューに意味がないため） |
| candidate_index | Integer | 0〜3（表示順） |
| image_path | String (nullable) | プレビュー画像の相対パス。失敗時はNULL |
| status | Enum(`"success"`, `"failed"`) | |
| error_message | Text (nullable) | 失敗内容 |
| created_at | DateTime (timezone-aware, `server_default=func.now()`) | 生成日時 |

**マイグレーション管理**

- スキーマ変更は`Alembic`でバージョン管理する（`create_all()`のみに頼らない）。`spira-base`と同様、新規DB（`alembic_version`テーブルなし）では`create_all` + `stamp("head")`でブートストラップし、既存DBでは`upgrade head`で差分適用する初期化ロジックを`backend/database.py`に実装する。
- MVPとはいえ設計段階だけで2回スキーマを変更しているため、最初からマイグレーション運用に乗せておく。

**[変更]**
- v2の単一`generations`テーブルを`sessions`（セッション単位）＋`preview_images`（プレビュー4枚）の2テーブルに分割。プレビューと本番で1:4の関係になるため。
- `sessions.selected_preview_id`で「どのプレビューから本番を作ったか」を追跡できるようにした。
- （v5）`spira-base`・`asami.tokyo`の設計を参考に、FKの`ondelete`ポリシーと`index`、`status`系カラムのEnum化、タイムスタンプのDB側デフォルト（`server_default=func.now()`）、`sessions.created_at`へのインデックス、Alembicによるマイグレーション管理を追加。

## 5. APIエンドポイント設計 (FastAPI)

### `POST /api/generate/preview`

プレビュー4枚を生成する最初のステップ。

- リクエスト: `{"prompt": "夜の東京"}`
- 処理:
  1. Gemini (`gemini-2.5-flash`) でプロンプトを実写用英語プロンプトに拡張。
  2. `sessions`レコードを作成する（この時点では`final_*`はNULL）。
  3. 拡張後プロンプトで `gemini-3-pro-image` を **1K解像度・4回** 呼び出し、4枚のプレビューを生成。
     - Gemini APIの画像生成モデルは1回のリクエストで複数候補（`candidateCount`）を返す機能を提供していないため、**4回の個別呼び出しが必須**（[参考: Google AI Developers Forum](https://discuss.ai.google.dev/t/multiple-candidates-candidatecount-is-not-supported-for-image-generation-models/124694)）。
     - レイテンシ短縮のため`asyncio.gather`等で並列実行してよいが、レート制限に注意し、1枚でも失敗した場合はそのプレビューだけ`status: failed`として保存し、残り成功分は表示可能にする。
  4. 各結果を`preview_images`に保存。
- レスポンス: `{"session_id": 1, "enhanced_prompt": "...", "previews": [{"preview_id": 1, "candidate_index": 0, "image_path": "...", "status": "success"}, ...4件]}`

### `POST /api/generate/finalize`

プレビューから1枚選択し、4K本番画像を生成する2番目のステップ。

- リクエスト: `{"session_id": 1, "preview_id": 3}`
- 処理:
  1. `preview_id`が該当`session_id`に属することを検証。
  2. 選択したプレビュー画像を**参照画像（reference image）**として`gemini-3-pro-image`に渡し、同一の`enhanced_prompt`・`image_size="4K"`で再生成する。Nano Banana Proは参照画像を使った編集・高解像度化に対応しており、プレビューの構図をできるだけ保持したまま4K化する狙い。
  3. 画像を`backend/static/images/`に保存し、`sessions.final_image_path` / `final_status` / `finalized_at`を更新。
- レスポンス: `{"session_id": 1, "image_path": "...", "status": "success", "created_at": "..."}`
- **タイムアウト方針**: 4K生成は1K比で処理時間が長くなる想定。FastAPI側・フロントfetch側とも十分なタイムアウト値（例: 60〜120秒）を設定し、フロントはローディング状態を明示する。

### `GET /api/history`

- 処理: `final_status = "success"`の`sessions`を降順（新しい順）で取得。`limit` / `offset` クエリパラメーターでページネーション対応。プレビュー画像（`preview_images`）は含めない。
- レスポンス: セッション（本番結果）オブジェクトの配列。

### 静的ファイル配信

`app.mount("/static", StaticFiles(directory="static"), name="static")` などを設定し、フロントエンドから画像URLにアクセスできるようにする。フロントでは `NEXT_PUBLIC_API_URL` と `image_path` を結合して絶対URLを組み立てる処理を`components`側に明記する。

**[変更]**
- v2の単一`POST /api/generate`を`POST /api/generate/preview`と`POST /api/generate/finalize`の2エンドポイントに分割。
- `candidateCount`非対応という技術制約と、参照画像を使った4K化の方針を明記。
- タイムアウト方針を本番生成（finalize）側に明記する（4K生成の高レイテンシを考慮）。
- 履歴取得にページネーションを追加。

## 6. コアロジックとシステム制約（重要）

**プロンプト拡張の絶対ルール**

`gemini-2.5-flash` 等に渡すシステムプロンプトには、以下の指示を必ず含めること。

- 「出力は画像生成用の英語プロンプトのみとすること」
- 「必ず実写表現（Photorealistic, live-action style）となるようにプロンプトを構築すること」
- 「アニメ調、イラスト調の表現は絶対にNG（除外）とすること」
- 「カメラのレンズ、被写界深度、ライティングなどを指定して実写の質感を高めること」

※これはプロンプトによるソフト制約であり、モデルが100%遵守する保証はない。安全フィルタによる拒否や、意図しないスタイルでの生成が発生した場合の扱い（そのまま`status: failed`として記録し再試行はユーザー操作に委ねる、など）をMVPでは簡易的に定義しておく。

**画像生成パラメーター**

- モデル: `gemini-3-pro-image`（プレビュー・本番とも同一モデルで統一。スタイルの一貫性を優先）
- プレビュー: `image_size="1K"` を4回（`candidate_index` 0〜3）
- 本番: 選択したプレビューを参照画像として渡し、`image_size="4K"`
- 正式なパラメーター名・指定方法はSDKバージョンにより変わる可能性があるため、実装直前に最新の[公式ドキュメント](https://ai.google.dev/gemini-api/docs/image-generation)で確認する。

**CORS設定**

Next.jsのローカルサーバー（`http://localhost:3000`）からFastAPI（`http://localhost:8000`）へのリクエストを許可するCORSミドルウェアを設定すること。

**[変更]**
- 画像生成パラメーター節を「プレビュー用」「本番用」に分けて明記。
- 安全フィルタ拒否時の扱いを明記。

## 7. セキュリティ設計（認証・レート制限・入力バリデーション）

v3までは「完全ローカル・個人利用」を前提に認証機構がなかった。実務利用（社内共有やローカル外からのアクセスを想定する場合）を見据え、最低限の防御を追加する。

**認証**

- MVPでは簡易的な共有トークン方式を採用する。`backend/.env`に`APP_API_TOKEN`を設定し、フロントエンドからの全リクエストに`Authorization: Bearer <token>`ヘッダーを必須とする。
- `backend/auth.py`にFastAPIの`Depends()`ベースの認証依存関数を実装し、`/api/generate/preview`・`/api/generate/finalize`・`/api/history`をガードする。
- 静的ファイル配信（`/static/*`）は画像表示用途のため認証対象外とする。推測困難なUUIDファイル名を維持することで簡易的な保護とする。
- 複数ユーザー対応（ログイン機能等）が必要になった場合は、この共有トークン方式をOAuth/JWTベースの認証に置き換える。

**レート制限**

- `slowapi`を導入し、画像生成系エンドポイント（`/api/generate/preview`・`/api/generate/finalize`）に制限をかける。
- デフォルト値: 1時間あたり10リクエストまで（環境変数`RATE_LIMIT_PER_HOUR`で調整可能）。1サイクル（プレビュー4枚＋本番1枚）で約$0.40のコストが発生するため、上限を超えたリクエストは429を返す。
- `/api/history`・静的ファイル配信は課金が発生しないため対象外とする。

**入力バリデーション**

- `prompt`フィールドはPydanticスキーマで必須・最大文字数（例: 200文字）を指定する。空文字列・空白のみの入力は400エラーとする。
- プロンプトインジェクション対策として、ユーザー入力はシステムプロンプトの「指示」ではなく「データ」として扱うようテンプレート化する（例: `ユーザー入力: """{user_input}"""`のように明確に区切り、システムプロンプトの指示を上書きさせない）。

**[変更]**
- （v4）本セクションを新設。認証・レート制限がない状態は、誰でも課金付きAPIを呼び出せてしまうため、実務利用の前提条件として必須要件に格上げした。

## 8. コンテナ構成（Docker）

MVPの環境構築段階からコンテナ化を行う。当面はクラウドにはデプロイせず、`docker-compose`でローカル実行する。

**構成方針**

- `backend/Dockerfile`: `python:3.12-slim`をベースに、非rootユーザーで`uvicorn`を実行する。
- `frontend/Dockerfile`: マルチステージビルド（`node:20-slim`でビルドし、軽量イメージで`next start`を実行）とする。
- `docker-compose.yml`: `backend`・`frontend`の2サービスを定義する。
  - `backend`: `history.db`と`static/images/`をnamed volumeでホストに永続化し、コンテナ再作成時にデータが消えないようにする。
  - `frontend`: 開発時はソースをbind mountしてホットリロードを有効化する。
  - `.env`ファイルは`env_file`で読み込み、イメージには焼き込まない。
- `.dockerignore`を`backend/`・`frontend/`それぞれに用意し、`.env`・`node_modules`・`__pycache__`・`history.db`等を除外する。

**セキュリティ配慮**

- 各コンテナは非rootユーザーで実行する。
- `docker-compose.yml`ではポートをホストの`localhost`にのみバインドする（例: `127.0.0.1:8000:8000`）ことで、ローカル実行時に意図せず外部公開しないようにする。
- 将来クラウド展開する際は、`backend/Dockerfile`をそのままCloud Run等にデプロイできる想定。ただしSQLite・ローカルディスク永続化の設計は別途見直しが必要（前回議論の通り）。

**[変更]**
- （v4）本セクションを新設。クラウド展開時ではなく、MVP環境構築の段階からコンテナ化する方針に変更した。実行自体は当面ローカル（`docker-compose`）で行う。

## 9. Google AI Pro特典の活用について

- 前提: Google AI Pro契約済み、決済方法登録済み、Gemini API用のAPIキーは今回新規発行する。
- **テキスト拡張**: `gemini-2.5-flash`系は無料枠（Free of charge）で利用可能。課金・クレジット消費は発生しない。
- **画像生成**: 無料枠が存在せず、Cloud Billing有効化が必須。`gemini-3-pro-image`は1K出力が約$0.039/枚、4K出力が約$0.24/枚。
- **コスト試算（1サイクル = プレビュー4枚＋本番1枚）**:
  - プレビュー: $0.039 × 4枚 ＝ 約$0.156
  - 本番: 約$0.24
  - 合計: 約$0.40/サイクル
  - Google Developer Program経由の月$10クレジットで、**約25サイクル/月**まで実質無料。それを超えた分は登録済みの決済方法から通常課金される。
- **セットアップ手順**:
  1. Google Developer Programダッシュボードで$10クレジットの特典をCloud Billingアカウントに紐付け
  2. そのBillingアカウントに紐づくCloudプロジェクトを作成（または既存プロジェクトを使用）
  3. AI Studioで新規APIキーを発行し、`backend/.env`の`GEMINI_API_KEY`に設定
- コストを抑えたい場合は、プレビュー用モデルのみ`gemini-3.1-flash-image`（Nano Banana 2、より安価）に切り替える選択肢もある。本番生成の参照画像入力にはそのまま使えるため、品質への影響は小さい。

**[変更]**
- v2は本番1枚のみの試算（約41枚/月）だったが、プレビュー4枚のコストを加えた1サイクル単位の試算（約25サイクル/月）に更新。

## 10. Claude Codeへの実装指示事項

上記の設計に基づき、以下のステップで実装を進める。

1. プロジェクトルートで `backend` と `frontend` のディレクトリを作成し、初期化する。`docker-compose.yml`と各`Dockerfile`もこの段階で用意する。
2. バックエンドの実装（FastAPI・SQLite・Gemini API連携・StaticFiles設定・CORS設定・認証・レート制限）。
   - `sessions` / `preview_images` の2テーブルと、`/api/generate/preview` / `/api/generate/finalize` の2エンドポイントを実装する。
   - `auth.py`で共有トークン認証、`slowapi`でレート制限を実装する。
   - 実装直前に `gemini-3-pro-image` の解像度指定パラメーター名・参照画像の渡し方・レスポンス仕様を[公式ドキュメント](https://ai.google.dev/gemini-api/docs/image-generation)で再確認する（モデル・パラメーター名は変更頻度が高いため）。
3. フロントエンドの実装（Next.js・フォームUI・プレビュー4枚の選択UI・履歴ギャラリー表示・ローディング状態表示）。
4. `frontend/.env.local` と `backend/.env` の雛形を作成。`backend/.env`には`GEMINI_API_KEY`・`APP_API_TOKEN`・`RATE_LIMIT_PER_HOUR`を含める。
5. `docker-compose up`でbackend・frontendを起動し、新規発行したAPIキーで疎通確認（テキスト拡張・1Kプレビュー生成・参照画像を使った4K本番生成それぞれ）を行ってから、UI実装に進む。

**[変更]**
- ステップ2に「プレビュー/本番の2エンドポイント実装」「認証・レート制限の実装」「実装直前の最新仕様確認」を追加（Google側のモデル・パラメーター変更が頻繁なため）。
- ステップ3に「プレビュー4枚の選択UI」を追加。
- ステップ1で`docker-compose.yml`・`Dockerfile`の用意を追加。ステップ4で認証用の環境変数を追加。
- ステップ5を`docker-compose up`での起動・疎通確認に更新。プレビュー生成・参照画像による本番生成の両方に対応。
