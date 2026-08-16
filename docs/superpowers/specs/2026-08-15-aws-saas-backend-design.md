# AWS SaaS バックエンド定番構成の学習環境（モノレポ / Terraform + TypeScript）

## Context

AWS における SaaS の「定番構成」を、Terraform で自分で組み立ててフロントエンド／バックエンドから繋ぐことで体系的に学ぶ。

**設計を支配する制約: 月 $10 の予算アラート。**

教科書どおりに常時起動すると、学習価値のほぼない「配管」だけで予算を大きく超える:

| 常時起動した場合 | 月額目安 |
|---|---|
| NAT Gateway ×1 | ~$35-40 |
| ALB | ~$18-22 |
| RDS db.t4g.micro | ~$12-15 |
| Fargate 0.25vCPU/0.5GB ×2 | ~$20-30 |
| DynamoDB / SQS / S3 / ECR / Secrets Manager / Cognito / **CloudFront** | ~$2 |

最終行は実質ゼロ（CloudFront は時間課金がなく、無料枠も大きい）。そこで **Terraform をサービス別ではなくライフサイクル別に分割し、高コスト層は触るときだけ apply して終わったら destroy する**。どの層が高コストか・どの層がステートフルかを意識してモジュール境界を切ること自体が学習成果になる。

想定コスト: 常時分 ~$2/月（シークレット2本 $0.80 + S3/ECR/CloudFront/DynamoDB 数十セント）+ 1セッション(4時間)あたり ~$0.6。月10セッションでも **$8 前後**。

### 確定済みの方針

- コスト方針: **セッション毎に destroy**
- ネットワーク: **private subnet + NAT Gateway**（教科書どおりの本番構成）
- 追加要素: ALB / ECR / CloudWatch Logs / IAM 2種ロール、Cognito、CI/CD (GitHub Actions + OIDC)
- **フロントエンド**を追加（S3 + CloudFront）
- **ユニットテスト**を構成に含める（AWS には繋がない方針）
- **モノレポ**（アプリ + インフラ）、ツールは **mise** でプロビジョニング、コマンドは **justfile** に集約
- **lint** は対象ごとにツールを分ける（Biome / TFLint / hadolint / actionlint / gitleaks）
- 独自ドメイン / Route53 / ACM は対象外（未所持）
- タスク管理: リポジトリ内ドキュメントのみ

---

## ツールチェーン（mise で固定）

`mise.toml` をリポジトリ直下に置き、必要なツールを全てここで固定する。

```toml
[tools]
node       = "24.19.0"   # LTS。`mise latest node@lts` の解決結果と一致
pnpm       = "latest"
terraform  = "1.15.8"
just       = "1.58.0"
tflint     = "latest"
awscli     = "latest"
hadolint   = "latest"    # Dockerfile lint
gitleaks   = "latest"    # シークレット検出（pre-commit）
actionlint = "latest"    # GitHub Actions workflow lint

[env]
AWS_PROFILE = "personal"
AWS_REGION  = "ap-northeast-1"
```

**このプロジェクトでは node を mise が持つ。nvm は関与させない。** 2つのバージョンマネージャが `node` を奪い合うのは、原因のわかりにくい壊れ方をする。

**PATH の落とし穴（M0 ゲート①・解決済み）**: justfile のレシピは非対話シェルで走るため、nvm のようなシェル関数ベースの管理では `node not found` になる。検証の結果、justfile 冒頭に以下を置くことで、非対話シェルからでも mise.toml が固定したツールを確実に解決できることを確認した:

```just
set shell := ["mise", "exec", "--", "sh", "-c"]
```

mise の shims を PATH に恒久的に追加する方式（ユーザーのシェル設定に依存する）は採らず、justfile 側で自己完結させている。

### 調査済みの一次情報（構造はここに合わせる）

- [AWS Prescriptive Guidance — Terraform コードベース構造](https://docs.aws.amazon.com/prescriptive-guidance/latest/terraform-aws-provider-best-practices/structure.html) — 標準ファイルセット、モジュール化の原則、命名規約、attachment リソース、default_tags
- [Terraform S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3) — **`use_lockfile` が現行。`dynamodb_table` は deprecated で将来削除**（DynamoDB ロックテーブルは作らない）
- [Turborepo 公式 structure ガイド](https://github.com/vercel/turborepo/blob/main/skills/turborepo/references/best-practices/structure.md) — `apps/*` + `packages/*`、`@repo/` 名前空間、`packages/**` のようなネストしたワイルドカードは禁止、ルートタスクではなくパッケージタスクを使う
- [delvedor/fastify-example](https://github.com/delvedor/fastify-example)（Fastify メンテナ作）— `plugins/` + `routes/` の2トップレベル構成、ESM、async ハンドラ
- [Fastify Type Providers](https://fastify.dev/docs/latest/Reference/Type-Providers/) — 公式サポートは json-schema-to-ts / typebox / zod。**TypeBox を採用**
- [Node.js TypeScript サポート](https://nodejs.org/api/typescript.html) — 型除去は **v24.12.0 で Stable**（24.19.0 は対象）。`.ts` 拡張子必須、`enum`/デコレータ/パラメータプロパティ不可、`node_modules` 配下には適用されない

---

## 全体構成

```
                    ┌──────────── CloudFront (HTTPS, *.cloudfront.net) ────────────┐
   ブラウザ ──HTTPS──┤  default behavior  → S3 (React SPA)                          │
                    │  /api/*            → ALB → ECS Fargate (api)                 │
                    └──────────────────────────────────────────────────────────────┘
                                    │
   Cognito User Pool ──── JWT ──────┤
                                    │
              ECS Fargate (api)  ─┬─→ RDS PostgreSQL      (RDB)
              (private subnet)   ├─→ DynamoDB            (NoSQL)
                                 ├─→ S3                  (オブジェクト)
                                 ├─→ Secrets Manager     (DB 認証情報)
                                 └─→ SQS ──→ ECS Fargate (worker) ──→ DynamoDB
                                                  └─ 失敗時 ─→ DLQ
              NAT GW ←── private subnet からの outbound (ECR pull 等)
```

**CloudFront を2オリジンにするのが要**。ドメインを持っていなくても `*.cloudfront.net` の証明書で HTTPS になる。これで3つの問題が同時に解ける:

1. **mixed content** — HTTPS のページから HTTP の ALB は呼べない。CloudFront が HTTPS を終端し、CloudFront → ALB は HTTP でよい
2. **CORS** — フロントと API が同一オリジンになるので CORS 設定が要らない
3. **Cognito** — Cognito は localhost 以外では HTTPS を要求する

SPA ルーティングのため、CloudFront の `custom_error_response` で 403/404 を `/index.html` に返す。

**`/api/*` のビヘイビアは必ず「キャッシュしない・ヘッダを素通しする」設定にする。** CloudFront のデフォルトビヘイビアはヘッダをほぼ転送せず、レスポンスをキャッシュする。そのままだと **`Authorization` ヘッダが落ちて JWT が Fastify に届かず全部 401 になる**（しかもアプリのバグに見える）。マネージドポリシーで:

- キャッシュポリシー: `CachingDisabled`
- オリジンリクエストポリシー: `AllViewerExceptHostHeader`

（マネージドポリシーの ID は実装時に確認する。CloudFront を API の前に置くときの最頻出の失敗はこれ）

`POST /api/items` 1本で RDB / NoSQL / S3 / Secrets / キューの5つを同時に触り、worker が SQS を drain して DynamoDB のステータスを更新する。1リクエストの流れを追えば全要素が繋がる。

---

## モノレポ構成

```
.
├── mise.toml                 # ツールのバージョン固定
├── justfile                  # 全コマンドの入口。just --list が学習の索引
├── pnpm-workspace.yaml       # apps/* と packages/* のみ。infra/ は含めない
├── package.json              # ルート。devDependencies と turbo だけ
├── turbo.json                # build / test / lint / typecheck のタスクグラフ
├── biome.json                # lint + format（JS/TS 全体）
├── .pre-commit-config.yaml   # Biome / TFLint / hadolint / gitleaks
├── apps/
│   ├── api/                  # Fastify（ECS Fargate）
│   ├── worker/               # SQS コンシューマ（ECS Fargate）
│   └── web/                  # Vite + React SPA（S3 + CloudFront）
├── packages/
│   ├── contracts/            # TypeBox スキーマ + 型。api と web が共有。AWS 依存なし
│   ├── core/                 # AWS クライアント / Drizzle / キュー / ドメイン。サーバ専用
│   └── tsconfig/             # 共有 tsconfig（@repo/tsconfig。base / library / app の3種）
├── infra/                    # Terraform。pnpm ワークスペース外
│   ├── bootstrap/
│   ├── platform/
│   ├── edge/
│   ├── network/
│   ├── data/
│   └── app/
├── docs/
│   └── superpowers/specs/
└── .github/workflows/
```

- パッケージ名は `@repo/` 名前空間（Turborepo 公式の推奨）
- `pnpm-workspace.yaml` は `apps/*` と `packages/*` のみ。ネストしたワイルドカード（`packages/**`）は公式に禁止されている
- **`infra/` はワークスペースに入れない**。Turborepo の公式ドキュメントは非 JS ディレクトリについて言及していないので、単にリポジトリ直下に同居させ、pnpm/turbo の管理外に置く
- ルートタスクは使わず、各パッケージの `package.json` にタスクを定義して `turbo run` で束ねる（公式の明示的な推奨）
- 共有 tsconfig は当初「ルート直下の `tsconfig.base.json`」を想定したが、実装時に **`packages/tsconfig` パッケージ（`@repo/tsconfig`）に一本化**した。`extends` の相対パスは宣言元の設定ファイルを基準に解決されるため、`rootDir`/`outDir` は各パッケージの `tsconfig.json` 側で指定する（共有ファイル側に書くと解決基準がずれてビルドが壊れる、と M0 で実際に踏んだ）

### パッケージの境界

| パッケージ | 何を持つ | 誰が使う | 依存してよいもの |
|---|---|---|---|
| `@repo/contracts` | TypeBox スキーマ、そこから推論した型 | api / web / worker | なし（isomorphic） |
| `@repo/core` | AWS SDK クライアント、Drizzle スキーマ + client、SQS 送受信、ドメインロジック | api / worker | `@repo/contracts` |
| `apps/api` | Fastify の `plugins/` + `routes/` | — | 上記2つ |
| `apps/worker` | SQS ポーリングループ | — | 上記2つ |
| `apps/web` | React SPA | — | `@repo/contracts` のみ |

`@repo/contracts` を分けている理由が monorepo の主目的。API のリクエスト／レスポンス定義が1箇所にあり、変更すると**フロントとバックの型が同時に壊れる**（＝ CI が気づく）。

### ビルド戦略（M0 で検証・確定）

- **`packages/*` は tsc でコンパイルする**（`dist/` を出力し、`exports` は `dist` を指す）。モノレポの標準パターンで、Node の「`node_modules` 配下の TS は型除去しない」制約を確実に回避できる
- **`apps/api` / `apps/worker` は自分のソースを型除去でそのまま実行**（`node --watch src/main.ts`）
- **したがって tsconfig は一枚岩にできない。** `@repo/tsconfig` に3種類の設定を用意し、`noEmit` はパッケージ側で選ぶ:

| | `noEmit` | 出力 | 役割 |
|---|---|---|---|
| `packages/*`（`@repo/tsconfig/library.json`） | `false` | `outDir: "dist"`、`declaration: true` | 実際にコンパイルする。`rewriteRelativeImportExtensions` が `./x.ts` → `./x.js` を書き換えるので必須 |
| `apps/api` / `apps/worker`（`@repo/tsconfig/app.json`） | `true` | なし | 型チェック専用。実行時は Node が型を落とす |
| `apps/web`（`@repo/tsconfig/app.json`） | `true` | なし | 型チェック専用。ビルドは Vite |

**M0 のゲート②（検証済み・フォールバック不要）**: Node 24.19 が `apps/api/src/main.ts` を実行するとき、pnpm の symlink 経由で `@repo/core` の `dist` を解決できるかを実機で確認した。`packages/contracts` → `packages/core` の順にビルドしたのち `node src/main.ts` を直接実行し、`/healthz` が `@repo/core` 経由の値を含めて正常応答することを確認済み。フォールバック（apps も tsc ビルド）は不要だった。

### Docker（`turbo prune` 必須）

pnpm ワークスペースをそのまま `COPY` すると、lockfile とワークスペースリンクが壊れる。`turbo prune --docker` で剪定した lockfile とスパースなワークスペースを生成してからビルドする。これが今回 Turborepo を入れる実利的な理由。

**api と worker は1つのイメージにまとめ、`CMD` で切り替える**（意図的な簡略化）。両者は `@repo/core` を共有しており、prune もビルドも ECR リポジトリも1つで済む。

---

## Terraform のレイヤー分割（ライフサイクル別）

AWS Prescriptive Guidance の標準構成は「1つの root module + `envs/*/terraform.tfvars`」だが、これは dev/stg/prod を分ける前提の話。今回は環境が `dev` 単一で、**軸はコストとライフサイクル**なので root module 自体を6つに分ける（＝ tfstate も6つ）。標準構成のファイル粒度は各層にそのまま適用する。

| 層（root module） | 中身 | ライフサイクル | コスト |
|---|---|---|---|
| `infra/bootstrap/` | tfstate 用 S3 バケット | 一度だけ。local state を commit | ~$0 |
| `infra/platform/` | アプリ用 S3, DynamoDB, SQS+DLQ, ECR, アプリ用シークレット, Cognito, GitHub OIDC provider/role | **常時起動** | ~$1/月 |
| `infra/edge/` | フロント配信用 S3, **CloudFront（2オリジン）** | **常時起動** | ~$0（時間課金なし） |
| `infra/network/` | VPC, public/private subnet ×2AZ, IGW, NAT GW, route table, SG | セッション毎 | NAT $0.062/h + EIP $0.005/h |
| `infra/data/` | RDS PostgreSQL, subnet group, parameter group, DB 認証情報のシークレット, SSM 踏み台用 EC2/IAM ロール | セッション毎・**ステートフル**（RDS のみ。踏み台 EC2 はステートレス） | ~$0.02/h（RDS）+ 踏み台 t4g.nano 分（僅少） |
| `infra/app/` | ALB, ECS cluster, task definition, service ×2, CloudWatch Logs, IAM task role / task execution role | セッション毎 | ALB $0.024/h + Fargate |

各層のディレクトリ（`data.tf` は必要になった時点で追加）:

```
infra/<layer>/
├── main.tf          # リソース本体（1種類のリソースにまとまる小さな層）
│                     # 複数種類のリソースを持つ層は main.tf を置かず、
│                     # リソース種別ごとのファイル（s3.tf, dynamodb.tf, ecr.tf 等）に分割する
├── variables.tf
├── outputs.tf       # 他層が参照する値。ARN / ID / エンドポイントのみ
├── providers.tf     # terraform block (backend含む) + provider block
├── versions.tf      # required_providers
└── README.md        # この層が何を作るか、他層との依存
```

`infra/bootstrap/` は単一リソース種別（S3）のみなので `main.tf` にまとめて実装済み（`aws_s3_bucket` + versioning + SSE-S3 + public access block + ownership controls、`prevent_destroy = true`）。`infra/platform/` は S3/DynamoDB/SQS/ECR/Secrets Manager と複数種別を持つため、最初からリソース種別ごとのファイルに分割して実装済み（`main.tf` は存在しない）。AWS provider は `~> 6.0` を採用（実装時点の最新メジャー）。

### なぜ CloudFront を「常時起動」層に置くか

CloudFront を `app/` 層（セッション毎）に置きたくなるが、**それは2つの理由で破綻する**:

1. **Cognito のコールバック URL がフロントのオリジンと一致している必要がある。** distribution を毎回作り直すと `*.cloudfront.net` のドメインが変わり、常時起動の `platform/` にある Cognito アプリクライアントの callback/logout URL を毎セッション書き換えるはめになる
2. **CloudFront の destroy は遅い。** Terraform は distribution を disable → 伝播待ち → 削除、と進むので `just down` の所要時間を支配する。しかも時間課金がないので消す金銭的な意味がない

**ALB オリジンの扱い（ここが設計の肝）**: ALB の DNS 名はセッション毎に変わる。そこで `edge/` 層に `var.alb_dns_name`（デフォルト空文字）を持たせ、`/api/*` のオリジンとキャッシュビヘイビアを `dynamic` ブロックで包み、**空でないときだけ生成される**ようにする。`just up` は `app/` の apply 後に `edge/` を「その ALB DNS 名を渡して再 apply」する。これは distribution の **更新**（数十秒〜数分）であって作成／削除ではないので速い。

ここで `terraform_remote_state` を使わないのは意図的。destroy 済みの層に対して空の output を返してわかりにくく落ちる、という問題を別途抱えているため（下記）。

**`just down` は `app/` を destroy する前に `edge/` を空の `alb_dns_name` で再 apply する。** そうしないと distribution が死んだ DNS 名を指したまま残り、次のセッションで `edge/` を再 apply するまで `/api/*` が 502 を返す。

**常時起動層どうしの apply 順は `edge/` → `platform/`。** Cognito（`platform/`）のコールバック URL に CloudFront ドメイン（`edge/`）が要るため。逆向きの依存はないので循環はしない。コールバック URL には **`http://localhost:5173` も併記して残す** — M7 で CloudFront を入れた後も M6 のローカル開発フローが動き続けるようにする。

### layer 間の配線

- 下位層の値は `terraform_remote_state` data source で読む（例: `app/` が `network/` の subnet ID と `data/` の RDS エンドポイントを読む）。この配線自体が学習ポイント
- 出力してよいのは ARN / ID / エンドポイントのみ。**DB パスワードなどの秘匿値は outputs に出さない**（`data/` の tfstate 内に留める）
- `terraform_remote_state` は **destroy 済みの層に対して空の output を返し、`plan` がわかりにくいエラーで落ちる**。`just up` は必ず network → data → app → edge の順で、途中を飛ばさない

### backend（S3 のみ、DynamoDB ロックテーブルは使わない）

- 全層が同一の tfstate バケット（`bootstrap/` で作成）を共有し、`key` だけ層ごとに変える（`platform/terraform.tfstate` など）
- ロックは `use_lockfile = true`（S3 ネイティブロック）。`dynamodb_table` は現在 deprecated で将来削除予定のため使わない

### providers.tf / versions.tf の重複について

6層それぞれに持たせる（symlink 等で共有しない）。内容はほぼ同一で重複するが、**各層が単独で `plan` できることを優先**する。共有すると層間に暗黙の依存が生まれ、「なぜこの層だけ apply できないのか」が調べにくくなる。

### その他（AWS 公式ガイド由来）

- 共通 `modules/` は作らない。単一リソースのラップは公式ガイドでも非推奨（"don't wrap single resources"）
- provider の `default_tags` で `Project` / `ManagedBy` / `Layer` を全リソースに付与
- workspace は使わない。環境は `dev` 単一
- SG ルールは `aws_security_group` の `ingress`/`egress` ブロックに埋め込まず、`aws_vpc_security_group_ingress_rule` / `..._egress_rule` として1リソース＝1ルールで書く（attachment resource パターン）
- 命名は snake_case、単数形、リソースタイプ名を名前に繰り返さない。用途がわかる名前をつける（例: `tfstate`, `app`, `items`, `items_dlq`）。`this`/`main` は使わない — その種類で唯一のリソースでも、後から読んだときに何を指すか一目でわかることを優先する
- アカウント ID をファイルに直書きしない。`data "aws_caller_identity" "current"` を使う
- TFLint は `infra/.tflint.hcl` で `terraform` プリセットに加え `tflint-ruleset-aws` を有効化し、AWS 固有のベストプラクティス違反を拾う

---

## シークレットと destroy 運用

### シークレットは2本に分ける

- **アプリ用シークレット**（外部 API キー相当）→ `platform/` 層。常時存在し、M1 の時点で Secrets Manager を学べる
- **DB 認証情報** → `data/` 層。RDS と生死をともにする

実際の SaaS でもこの2種類は寿命が違う。$0.40/月 × 2本。

### DB 認証情報に `manage_master_user_password` を使わない理由

RDS の `manage_master_user_password = true` は近年の定番だが、**この構成では採らない**。RDS が所有するシークレットは Terraform のリソースとして持てないため recovery window を制御できず、`just down` のたびに削除待ちのシークレットが $0.40/月ずつ残り続けるおそれがある。月10セッションなら $4/月 — 予算の4割が「消したつもりのもの」で消える。

代わりに `random_password` + `aws_secretsmanager_secret`（`recovery_window_in_days = 0`）を `data/` 層に置き、`aws_db_instance.password` に渡す。destroy で確実に消えるので状態が決定的になる。`manage_master_user_password` との違いは M3 のドキュメントに記録して比較材料として残す。

### destroy 運用で必ず踏む罠

1. **Secrets Manager の recovery window** — デフォルトで削除後7日間残り、同名で再作成できない。`recovery_window_in_days = 0` を明示
2. **Elastic IP の取り残し** — 未アタッチでも $0.005/h = $3.60/月。予算が静かに溶ける最大の経路。`just leaks` で毎回確認する
3. **RDS のデータは destroy で消える** — 学習用途なので受け入れる。`skip_final_snapshot = true` / `deletion_protection = false` を明示し、スキーマは Drizzle の migration、初期データは seed で毎回流し直す
4. **ECR は platform 層** — destroy してもイメージを残すため。ただし CI が全コミットでイメージを push するので、**lifecycle policy で「最新10個だけ残す」を必ず入れる**。1イメージ 200〜300MB × $0.10/GB月なので、数十個溜まると $10 予算の無視できない割合になる（衛生の話ではなく予算の話）
5. **S3 バケットの `force_destroy`** — 層ごとに扱いを明示（フロント配信用バケットは常時起動層なので destroy しない）

---

## justfile — コマンド集約と「あとから復習できる索引」

狙いは単なるショートカットではなく、**`just --list` がそのまま学習の索引になる**こと。M0 で実装・検証済み:

- **全レシピに doc コメントを付ける**（`just --list` に出るのはこのコメント）
- **`[group('...')]` でグループ分け** — `just --list` がグループ見出し付きで出る
- **`[confirm]` を破壊的レシピに**（`down`）
- **レシピ本体には実際の `terraform` / `aws` / `pnpm` コマンドをそのまま書く**。シェルスクリプトに逃がさない。「何が実行されたか」を後から読めることが目的
- 検証用の `aws` コマンドも README のコードブロックではなく**名前付きレシピ**にする

**`[group(...)]` は表示専用の属性で、名前空間は作らない。** `just` で `::` を使えるのは `mod` によるモジュール分割のときだけ。モジュールは justfile がファイル分割されて「実際のコマンドを1枚で読める」利点が薄れるので、**グループ + フラットなレシピ名**にした。

実装済みのグループ構成:

| group | レシピ | 内容 |
|---|---|---|
| `session` | `up` / `down` / `status` | 層をまたぐ apply / destroy のオーケストレーション |
| `tf` | `tf-plan <layer>` / `tf-apply <layer>` / `tf-fmt` / `tf-validate` / `tf-lint` | 層を引数に取る Terraform 操作 |
| `dev` | `dev-api` / `dev-worker` / `dev-web` / `dev-all` | ローカル開発サーバ |
| `check` | `typecheck` / `lint` / `test` / `test-watch` | turbo 経由の品質チェック（`lint` は Biome + `tf-lint` + hadolint + actionlint を束ねる） |
| `db` | `db-generate` / `db-migrate` / `db-seed` / `db-psql` | Drizzle と DB 接続 |
| `docker` | `image-build` / `image-push` | `turbo prune` → build → ECR push |
| `cost` | `cost-report` / `leaks` | コスト実績と消し残しリソースの検出 |

`set dotenv-load` は使わない（`.env` を作らない方針）。環境変数は `mise.toml` の `[env]` で与える。

**`just leaks` が最重要レシピ。** `just down` の後に必ず走らせる:

```just
# 消し残しリソースを検出する（down の後に必ず実行）
[group('cost')]
leaks:
    aws ec2 describe-nat-gateways --filter Name=state,Values=available
    aws ec2 describe-addresses
    aws elbv2 describe-load-balancers
    aws rds describe-db-instances
    aws secretsmanager list-secrets --include-planned-deletion
```

---

## アプリ

### `apps/api`（Fastify）

Fastify コミュニティの標準は `plugins/` + `routes/` の2トップレベル構成（[fastify-example](https://github.com/delvedor/fastify-example)）。共有ロジックは `@repo/core` に出してあるので、api 側にはこの2つだけが残る。

```
apps/api/src/
├── plugins/
│   ├── deps.ts       # @repo/core のクライアントを decorate して注入
│   └── auth.ts       # Cognito JWT 検証（M5）
├── routes/
│   ├── health.ts
│   └── items.ts
├── server.ts         # Fastify インスタンス組み立て（テストから直接呼べる）
└── main.ts           # listen するだけ
```

M0 時点では `routes/health.ts` と `server.ts` / `main.ts` のみ実装済み（`/healthz` が `@repo/core` の関数を呼んで応答することを確認）。`plugins/`・`items.ts` は M1 以降で追加する。

- `GET /healthz` — ALB ヘルスチェック用（認証不要）
- `POST /api/items` — RDS insert → DynamoDB put → S3 保存 → SQS enqueue
- `GET /api/items/:id` — RDS から取得
- **スキーマは `@repo/contracts` の TypeBox 定義を使う**（`@fastify/type-provider-typebox`）。JSON Schema がそのまま Fastify のバリデーションとレスポンスシリアライズに使われ、同時に TS の型も推論される（コード生成なし）
- ログは pino の JSON をそのまま stdout へ。CloudWatch Logs 側で構造化ログとして扱える
- `host: '0.0.0.0'` で listen（localhost 固定だと ALB のヘルスチェックが通らない定番の罠）
- **`server.ts` と `main.ts` を分ける**のはテストのため。テストは `server.ts` を import して `app.inject()` で HTTP レイヤを実際のポートなしに叩ける
- プラグイン／ルートは `@fastify/autoload` を使わず**明示的に `register`**
- `plugins/` は `fastify-plugin` でラップしてカプセル化を解除、`routes/` はラップせずカプセル化境界を効かせる

### `apps/worker`

- `@repo/core` の SQS クライアントで long polling → 処理 → DynamoDB のステータス更新 → メッセージ削除
- 失敗時は可視性タイムアウト経由で再試行、規定回数超で DLQ
- SIGTERM で処理中のメッセージを終えてから終了（ECS のタスク停止に対応）

### `apps/web`（Vite + React SPA）

- Vite + React + TypeScript。データ取得は TanStack Query
- `@repo/contracts` の型を使って API を呼ぶ。スキーマが変わればここが型エラーになる
- 認証は Cognito（`aws-amplify/auth` もしくは `oidc-client-ts`）。M5 で追加
- ビルド成果物を `edge/` 層の S3 バケットに同期し、CloudFront のキャッシュを invalidate する
- **ローカル開発では Vite の dev server proxy で `/api` を「ローカルで動かしている `apps/api`」に転送する。** ALB ではなくローカルの api に向けるのが要点で、これなら `network/`〜`app/` を apply していない（＝課金セッションを開いていない）状態でもフロントを進められる。CloudFront 経由の確認は M7 で行う

### Node の型除去に伴う制約

- 相対 import には **`.ts` 拡張子を必ず書く**（`import { x } from './lib/aws.ts'`）
- `enum` / パラメータプロパティ / 実行時 `namespace` / デコレータは使えない
- `tsconfig` は Node 公式推奨の `noEmit` / `module: nodenext` / `erasableSyntaxOnly` / `verbatimModuleSyntax` / `rewriteRelativeImportExtensions`。`erasableSyntaxOnly` があれば使えない構文を tsc が弾く
- Node は `tsconfig.json` を読まないので **`paths` エイリアスは使えない**。パッケージ間はワークスペース参照、パッケージ内は相対パス
- Drizzle も TypeBox も上記制約に抵触しない（デコレータを使わない）
- **この制約は `apps/api` / `apps/worker` の実行時のみ。** `apps/web` は Vite が、テストは Vitest が TS を処理するので影響しない

### 認証情報の扱い（全層共通）

- AWS 認証は SDK v3 のデフォルト探索に任せる。クライアント生成時に認証情報を渡さない（`new S3Client({})`）。ローカルは SSO、Fargate は task role、CI は OIDC
- DB パスワードは `random_password` で生成して Secrets Manager に格納し、アプリは実行時に取得する。**Terraform の変数にもファイルにも実値を置かない**（tfstate には入るので、state バケットは暗号化・非公開・バージョニング有効にする）

---

## テスト

**Vitest** を全パッケージ共通で使う（monorepo のワークスペース対応が第一級、ESM/TS ネイティブ、Vite と同じ変換パイプラインを frontend と共有できる）。`turbo run test` で束ねる。M0 時点で `@repo/contracts` / `@repo/core` / `apps/api` にテストを実装済み、全て green。

| 対象 | 何をテストするか | AWS への依存 |
|---|---|---|
| `@repo/contracts` | スキーマのバリデーション（不正な入力を弾くか） | なし |
| `@repo/core` | ドメインロジック。AWS クライアントはインターフェース越しにモック | なし |
| `apps/api` | `app.inject()` でルートを HTTP レベルで検証。`@repo/core` はモック | なし |
| `apps/worker` | メッセージハンドラの単体テスト | なし |
| `apps/web` | コンポーネントテスト（Vitest + Testing Library、環境は jsdom） | なし |

**方針: ユニットテストは AWS に一切繋がない。** 実 AWS に繋ぐ確認は各マイルストーンの受け入れ条件（下記「検証方法」）で手動で行う。これは学習プロジェクトで LocalStack 等を導入するとそちらの学習コストが乗るため、意図的にスコープ外にしている。

---

## Lint — 対象ごとにツールを分け、pre-commit と CI の両方で回す

このリポジトリは TypeScript / Terraform / Dockerfile / GitHub Actions workflow の4種類の構文を持つ。**1つの lint ツールで全部は見られない**ので、対象ごとに標準的なものを当てる。

| 対象 | ツール | 検出するもの |
|---|---|---|
| TypeScript / JavaScript | **Biome** | 未使用変数、import順、フォーマット崩れ |
| Terraform | **TFLint**（`terraform` + `tflint-ruleset-aws`） | AWS プロバイダ固有のベストプラクティス違反（`terraform validate` は構文のみ、TFLint は意味的なチェック） |
| Dockerfile | **hadolint** | Dockerfile のベストプラクティス違反。内部で shellcheck も走るので `RUN` 内のシェルの問題も拾う |
| GitHub Actions workflow | **actionlint** | `ci.yml` / `deploy-api.yml` / `deploy-web.yml` の構文・型ミス |
| シークレット（全体） | **gitleaks** | API キーやパスワードのコミット誤り。pre-commit フックで実行し、コミット自体をブロックする |

**gitleaks は pre-commit 専用、他の4つは pre-commit + CI の両方**で走らせる。理由: シークレットの検出は「そもそもコミットさせない」ことに価値があるので pre-commit の役割。それ以外は pre-commit をスキップした push や PR でも CI が最終防波堤として拾う必要がある。`actionlint` は `.github/workflows/` を編集しないコミットでも毎回走らせる意味が薄いので pre-commit には含めず **CI 専用**にした。

justfile の `check` グループにある `lint` レシピが4種類（Biome / TFLint / hadolint / actionlint）を束ね、`tf` グループの `tf-lint` を内部で呼ぶ。CI (`ci.yml`) はこの `just lint` 一発で全部回す。

M0 時点で Biome / TFLint は実装・検証済み（`biome check` clean、`tflint --recursive` clean）。hadolint / actionlint / gitleaks は対象ファイル（Dockerfile / workflow）がまだ無いため、mise でのインストールと `.pre-commit-config.yaml` への配線のみ完了。

---

## CI/CD — CI と CD を明確に分ける

一般的なチュートリアルをそのまま真似すると壊れる。「push したら ECS にデプロイ」は **ECS サービスが常時存在する前提**で書かれているが、この構成では `app/` 層はセッション後に destroy 済み。何もない状態に `update-service` すると毎回失敗する。

| | トリガー | やること | 依存する層 |
|---|---|---|---|
| **CI** (`ci.yml`) | 全 push / PR | `turbo run typecheck test`、`terraform fmt -check` / `validate`、`just lint`（Biome + TFLint + hadolint + actionlint）、`turbo prune` → Docker ビルド → **commit SHA タグ**で ECR push | `platform/` のみ（常時存在するので必ず通る） |
| **CD** (`deploy-api.yml`) | `workflow_dispatch`（手動）| タスク定義を登録して ECS サービスを更新 | `app/` が apply 済みのときだけ |
| **フロント配信** (`deploy-web.yml`) | main への push | `apps/web` をビルド → S3 に同期 → CloudFront invalidate | `edge/` のみ（常時存在するので自動でよい） |

フロントだけ自動デプロイにできるのは、`edge/` が常時起動層だから。**CI/CD の粒度がインフラのライフサイクルに従う**という、この構成ならではの学びがある。

- 認証は **GitHub OIDC → IAM ロールを assume**。アクセスキーは GitHub Secrets に置かない（`aws-actions/configure-aws-credentials`、`permissions: id-token: write`）
- OIDC provider とロールは `platform/` 層。信頼ポリシーの `sub` 条件でリポジトリとブランチを絞る
- **イメージタグに `latest` を使わない**。commit SHA でタグ付けし、どの SHA が動いているか特定できる／ロールバックできる状態にする

---

## マイルストーン（安い順・学習が先、支出は後）

**M0: 土台 — 完了**
- ✅ 設計を本ドキュメントに書いて commit
- ✅ `mise.toml` / `justfile` / `pnpm-workspace.yaml` / `turbo.json` / `biome.json` / `@repo/tsconfig`
- ✅ `@repo/contracts`（TypeBox スキーマ + Vitest）/ `@repo/core`（プレースホルダ）/ `apps/api`（health のみ）の骨組み
- ✅ `.pre-commit-config.yaml`（Biome / TFLint / hadolint / gitleaks）
- ✅ **ゲート①**: `set shell := ["mise", "exec", "--", "sh", "-c"]` で解決
- ✅ **ゲート②**: フォールバック不要と確認（Node の型除去 + pnpm symlink で `@repo/core` を直接解決できる）
- ✅ `infra/bootstrap/` 実装・apply 済み（tfstate バケット `learn-aws-saas-ts-tfstate-<account_id>` を作成。local state を commit）

**M1: platform 層 — VPC 不要で4要素を体感（月$1）**
- `infra/platform/` を `infra/bootstrap/` と同じファイル構成（main/variables/outputs/providers/versions.tf + README.md）で実装し、backend は bootstrap のバケットを参照する S3 backend（`key = "platform/terraform.tfstate"`）
- S3（アプリ用オブジェクト、非公開）/ DynamoDB（テーブル名 `items`、PK=`id` の String のみ。items ドメインの属性が固まるのは M4 以降だが DynamoDB はスキーマレスなので先に作って困らない）/ SQS+DLQ（`visibility_timeout=30秒`、`maxReceiveCount=3`）/ ECR（lifecycle policy で最新10個のみ保持）/ アプリ用シークレット（Secrets Manager。キー名だけ決めてダミー値のプレースホルダ。実際の外部 API キーは持たない想定）を apply
- **GitHub OIDC provider/role はここでは作らない。** 表（Terraform のレイヤー分割）には platform 層の内容として記載しているが、実際に使うのは M8（CI/CD）なので作るタイミングを合わせ、M8 でまとめて追加する
- `@repo/core` に `s3.ts` / `dynamodb.ts` / `sqs.ts` / `secrets.ts` の薄いクライアントラッパーを実装（ドメインロジックは含めない。M4 以降で items の CRUD を追加）し、ローカルから SSO 認証情報で直接叩いて動作確認
- **ここまで VPC も ALB も RDS も要らない。学びたい6要素のうち4つがこの時点で終わる**

**M2: network 層 — apply/destroy サイクルを体で覚える**
- VPC `10.0.0.0/16`（`ap-northeast-1a` / `1c` の2AZ）。public/private 各2つ、`/20` で4分割（`10.0.0.0/20`, `10.0.16.0/20`, `10.0.32.0/20`, `10.0.48.0/20`）
- NAT Gateway ×1（public subnet 1a に配置、EIP付き）。private subnet 1a/1c は共通の1つの private route table で NAT GW を共有する（コスト最優先。マルチAZ冗長化はしない）
- SG は ALB用/ECS用/RDS用の3つをこの層でまとめて作り、SG ID 同士の参照でチェーンを組む: `alb`（80/443 from `0.0.0.0/0`）→ `ecs`（`var.app_port`=3000 from `alb` SG）→ `rds`（5432 from `ecs` SG）。ALB/ECS/RDS 自体のリソースは M3/M4 で作るが、SG という「箱」と ingress ルールは VPC の一部としてここに置く（M3 で SSM 踏み台用の `bastion` SG と `rds` への追加 ingress ルールをこの層に追加する。詳細は「M3: data 層」節）
- ファイル構成は `infra/platform/` に倣いリソース種別ごとに分割（`vpc.tf` / `subnets.tf` / `routing.tf` / `security_groups.tf`）。命名は `this`/`main` を使わず用途名（`app`, `alb`, `ecs`, `rds` 等）
- outputs: `vpc_id` / `public_subnet_ids` / `private_subnet_ids` / `alb_security_group_id` / `ecs_security_group_id` / `rds_security_group_id` / `nat_gateway_id` / `aws_region`
- `just up` / `just down` は `network → data → app → edge` の4層を前提にしており、`data`/`app`/`edge` が未実装の現時点では動かせない。M2 では新規追加する単層コマンド `just tf-apply network` / `just tf-destroy network` で検証する。`up`/`down` への組み込みはレイヤーが揃うにつれ段階的に行う（M3 で `data` の行を追加、M4 で `app` の行を追加してバックエンドまで通しで動くようになり、M7 で `edge` の行を追加して完成する）
- 「なぜ private subnet に NAT が要るのか」を、private route table の `0.0.0.0/0` ルートを一時的に外して実際に確かめる（README.md に手順を記載。自動化はしない）

**M3: data 層 — RDS**

PostgreSQL `db.t4g.micro`、`random_password` + Secrets Manager（recovery window 0）、SSM Session Manager のポートフォワードで接続、Drizzle でスキーマ定義 → `drizzle-kit generate` → migration 適用、seed で初期データ。

**SSM 踏み台（bastion）が必須**: `AWS-StartPortForwardingSessionToRemoteHost` は SSM 管理下のインスタンスを起点に任意の `host:port` へフォワードする仕組みで、RDS 自体は SSM 管理ノードになれない。ECS Exec も interactive command のみでポートフォワードに対応しないため、M4（ECS）を待つ選択肢もない。**t4g.nano の EC2 を `infra/data/` に session 毎リソースとして追加する**（IAM ロールは `AmazonSSMManagedInstanceCore` のみ、SSH 鍵なし、パブリック IP なし、private subnet 配置。SSM Agent の通信は既存の NAT Gateway 経由 — VPC エンドポイントは M9 で比較対象として温存する）。

- **bastion の配置**: 実体（EC2・IAM ロール・instance profile）は `infra/data/`（RDS 接続専用でライフサイクルが一致するため）。SG という「箱」は M2 の慣習どおり `infra/network/security_groups.tf` に追加する（`aws_security_group.bastion` + `rds` への ingress ルール追加）。ingress は不要（SSM Agent は自分から接続しに行くだけ）、egress は 443 のみ許可（`ecs_https` と同じ理由）
- **AMI**: Amazon Linux 2023 arm64（t4g と同じ Graviton）。`data.aws_ami` の name filter ではなく、AWS が SSM Parameter Store で公開する最新 AMI ID（`/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64`）を参照する。命名規則変更に強く、常に最新
- **PostgreSQL バージョン**: `engine_version = "17"`（メジャーのみ固定、マイナーは AWS に任せる）。`db.t4g.micro` は 12〜18 系まで対応済みだが、17 系は実績のある安定版を選ぶ（TypeScript 5.9 系採用と同じ判断基準）
- **parameter group**: `aws_db_parameter_group.app`（family `postgres17`）に `rds.force_ssl = 1` を設定し、クライアント接続の TLS を強制する。空の箱にしない
- **暗号化**: `aws_db_instance.app` に `storage_encrypted = true`（デフォルトの AWS 管理キー、追加コストなし）
- **命名**: `username = "app"` / `db_name = "app"`（`admin`/`postgres` のような推測されやすい名前を避ける）。`identifier = "${var.project_name}-app"`（他層の `aws_vpc.app` 等と同じ命名慣習）
- **秘匿情報**: Secrets Manager には `{host, port, dbname, username, password}` の JSON を格納する。`random_password` で生成し **`ignore_changes` は付けない**（`infra/platform/secrets.tf` の `ignore_changes = [secret_string]` は手動投入値を Terraform に上書きさせないためのものだが、ここは `random_password` が Terraform 管理下にあり Terraform 側が正なので、`ignore_changes` を付けるとローテーション後に古いパスワードで固定されてしまう）
- **`random_password` の記号制約**: RDS のマスターパスワードは `/`・`@`・`"`・スペースを禁止する。デフォルトの `override_special` にはこれらが含まれるため、`override_special = "!#$%^&*()-_=+[]{}<>:?"` のように明示的に除外する（`terraform validate` は通るが `apply` 時に失敗する典型パターン）
- **`db-psql` の接続手順**: `terraform output` で取得した `bastion_instance_id` と RDS エンドポイントを使い、`aws ssm start-session --target <bastion_instance_id> --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=<rds_endpoint>,portNumber=5432,localPortNumber=5432` でトンネルを張り、別ターミナルで `PGSSLMODE=require psql -h localhost -p 5432 -U app -d app` で接続する（`verify-full` は RDS の CA 証明書バンドル取得が要るため採らない。`require` で経路暗号化のみ担保する現実的な落とし所）
- **`manage_master_user_password` を採らない理由**（再掲）: RDS が所有するシークレットは Terraform リソースとして持てず recovery window を制御できないため、`just down` のたびに削除待ちシークレットが残り続ける恐れがある。`random_password` + 自前の `aws_secretsmanager_secret`（recovery window 0）なら destroy で確実に消え、状態が決定的になる
- **`just up`/`just down` は既に `data` 層を組み込み済み**（M0 時点でスケルトンとして先に書かれていた）。M3 で `infra/data/` を実装すれば通しで動くようになる
- **`just leaks` に `aws ec2 describe-instances` を追加**（消し忘れた bastion の t4g.nano を検知対象にする。忘れると ~$3/月）

**M4: app 層 — バックエンドが全部繋がる**
- `turbo prune` → Docker ビルド → ECR push → ECS Fargate で api / worker 起動 → ALB 経由でアクセス
- **task role と task execution role の使い分け**をここで明示的に扱う（Fargate の定番のつまずきポイント）
- CloudWatch Logs でログを追う

**M5: Cognito**
- User Pool / App Client、api に JWT 検証プラグイン
- ALB の `authenticate-cognito` リスナーアクションは **HTTPS リスナー必須**のため使えない。アプリ層での JWT 検証が唯一の選択肢

**M6: フロントエンド（ローカルのみ）**
- `apps/web` を Vite + React で実装、`@repo/contracts` 経由で API を呼ぶ
- Vite dev server の proxy で `/api` を **ローカル起動の `apps/api`** に転送してフルスタックで動作確認
- Cognito ログインを組み込む（localhost は HTTPS 不要）
- **この段階では CloudFront も ALB も要らない。** ローカルの api に繋ぐので、課金セッションを開かずに進められる（M2〜M4 と並行してよい）

**M7: edge 層 — S3 + CloudFront で本番配信**
- フロント用 S3（非公開）+ CloudFront + OAC
- 2オリジン構成（default → S3、`/api/*` → ALB）と、SPA 用の `custom_error_response`
- Cognito のコールバック URL を CloudFront ドメインに設定
- `just up` に「`app/` の後に `edge/` を ALB DNS 付きで再 apply」を組み込む

**M8: CI/CD**
- `ci.yml`（全 push）/ `deploy-api.yml`（手動）/ `deploy-web.yml`（main への push）
- GitHub OIDC でアクセスキーなしの assume role

**（オプション）M9: NAT を VPC エンドポイントに置き換えて比較**
- Gateway 型(S3/DynamoDB)は無料、Interface 型は各 ~$7-8/月。コストと構成の違いを実測する

---

## 主要なファイル

| パス | 役割 |
|---|---|
| `mise.toml` | ツールのバージョン固定。node は LTS 24.19.0 |
| `justfile` | 全コマンドの集約。`just --list` が学習の索引 |
| `turbo.json` | build / test / lint / typecheck のタスクグラフ |
| `infra/bootstrap/` | tfstate バケット。local state を commit |
| `infra/{platform,edge,network,data,app}/` | 各層。5ファイル + README.md |
| `packages/tsconfig/` | 共有 tsconfig（`base` / `library` / `app`） |
| `packages/contracts/` | TypeBox スキーマ。api と web の契約 |
| `packages/core/` | AWS / Drizzle / キュー / ドメイン |
| `apps/api/src/server.ts` | Fastify 組み立て（テストから直接呼ぶ） |
| `apps/worker/src/main.ts` | SQS コンシューマ |
| `apps/web/` | Vite + React SPA |
| `Dockerfile` | `turbo prune` 前提。api / worker 共用 |
| `.pre-commit-config.yaml` | Biome / TFLint / hadolint / gitleaks |
| `.github/workflows/{ci,deploy-api,deploy-web}.yml` | CI / CD。CI 側で actionlint も実行 |
| `README.md` | セットアップ手順とコスト運用の注意 |

---

## 検証方法

各マイルストーンの完了条件:

- **M0** — `just --list` がグループ付きで出る（確認済み）。`just test` と `just typecheck` が緑（確認済み）。`just tf-validate` が通る（確認済み）。ゲート①②の結論が本ドキュメントに書かれている（本節）
- **M1** — ローカルから S3 put / DynamoDB put / SQS send-receive / Secrets Manager get が成功する
- **M2** — `just tf-apply network` → `terraform output` で subnet ID が出る → `just tf-destroy network` → `just leaks` が全てゼロ件
- **M3** — SSM ポートフォワード経由で psql が繋がり、Drizzle の migration 済みテーブルが見える
- **M4** — ALB の DNS 名に `curl -X POST /api/items` して 201、RDS/DynamoDB/S3 の3箇所に反映され、worker のログに処理完了が出る
- **M5** — JWT なしで 401、Cognito 発行の JWT ありで 201（`aws cognito-idp admin-initiate-auth` でトークン取得）
- **M6** — `just dev-all`（ローカル api + Vite）でブラウザから作成・一覧ができ、ログイン／ログアウトが動く
- **M7** — CloudFront の URL をブラウザで開いて SPA が表示され、同一オリジンの `/api/items` が**Authorization ヘッダ付きで**叩けて（＝401 にならない）、リロードしても SPA ルーティングが 404 にならない
- **M8** — `app/` を destroy した状態で push しても CI が緑になり、commit SHA タグのイメージが ECR に増える。`just up` 後に deploy-api を手動実行するとタスク定義リビジョンが上がる

**コスト検証（毎セッション必須）**: `just down` の後に `just leaks` と `just cost-report` を実行し、NAT / EIP / ALB / RDS / 削除待ちシークレットがゼロであることを確認する。

---

## 明示的にやらないこと

- 独自ドメイン / Route53 / ACM（未所持。HTTPS は CloudFront のデフォルト証明書で足りる）
- マルチ環境（dev/stg/prod）、Terraform workspace
- API Gateway（ALB + Fargate と役割が重複）
- マルチテナント分離の作り込み（構成を学ぶのが目的。SaaS のテナント設計は別テーマ）
- Terragrunt（層の分割と `terraform_remote_state` の配線を自分で書くことが学習目的なので抽象化しない）
- 共通 Terraform モジュールの抽出（各層に直接書いたほうが読んで学べる）
- LocalStack / testcontainers（ユニットテストは AWS に繋がない方針。統合確認は実 AWS で手動）
- Next.js（SSR サーバの置き場所が要り、Fargate の API と役割が競合する。SPA + S3/CloudFront のほうがこの構成では素直）
- Changesets（パッケージを npm に publish しないので不要）
- `@fastify/autoload` / `tsx`（前者は挙動未検証のため明示登録を採用、後者は Node ネイティブの型除去で足りる）
- TypeScript 7.0（Go 移植のネイティブコンパイラ。`latest` タグだが出たばかりでエコシステムの追随が未知数のため、枯れている 5.9系を採用）
