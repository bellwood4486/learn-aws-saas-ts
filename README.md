# learn-aws-saas-ts

AWS SaaS バックエンドの定番構成（コンテナ / RDB / NoSQL / キュー / シークレットマネージャー / S3 / CloudFront+Cognito）を Terraform と TypeScript モノレポで学ぶためのプロジェクト。

設計の詳細と各マイルストーンの内容は [`docs/superpowers/specs/2026-08-15-aws-saas-backend-design.md`](docs/superpowers/specs/2026-08-15-aws-saas-backend-design.md) を参照。

## セットアップ

```sh
mise trust
mise install       # node/pnpm/terraform/just/tflint/awscli/hadolint/gitleaks/actionlint を固定バージョンで導入
pnpm install
pre-commit install
```

AWS 認証は SSO（`AWS_PROFILE=personal`）を前提とする。`mise.toml` の `[env]` で固定済み。

## コマンド

すべて `justfile` に集約している。索引として一覧を確認できる:

```sh
just --list
```

主なもの:

| コマンド | 内容 |
|---|---|
| `just typecheck` / `just test` / `just lint` | 品質チェック（turbo 経由） |
| `just tf-plan <layer>` | 指定した層で `terraform plan` |
| `just up` / `just down` | セッション毎に立てる層（network/data/app/edge）をまとめて apply / destroy |
| `just leaks` | `down` の後に消し残しリソースを確認する（**必ず実行**） |
| `just dev-all` | ローカルで api + web を同時起動（api を実AWSのnetwork/data層に繋ぐ場合は下記「ローカルでのフロントエンド確認」を参照） |

## コスト運用

月 $10 の予算アラートを前提に、常時起動する層（`platform` / `edge`）と、触るときだけ apply する層（`network` / `data` / `app`）を分けている。**セッションの終わりには必ず `just down` → `just leaks` → `just cost-report` を実行し、NAT Gateway / Elastic IP / ALB / RDS / 削除待ちシークレットが残っていないことを確認する。**

詳しい理由は spec ドキュメントの「シークレットと destroy 運用」を参照。

## ローカルでのフロントエンド確認（M6 実機検証で判明した注意点）

`just dev-all` で `apps/web` からログイン・item作成・一覧確認をする場合、`apps/api` を実 AWS（`network`/`data` 層）に繋いで動かす必要がある。その際の注意点:

- **`just db-seed` で投入した初期データは `GET /api/items` で 500 エラーになる。** `db-seed` は RDS にしか行を insert せず、DynamoDB 側の status レコードを作らない。`listItems`（M6 で追加）は RDS の全行について DynamoDB の status を要求するため、`db-seed` 由来の行はここで例外を投げる。ブラウザ確認をする際は `db-seed` を実行しない（または先に `items` テーブルを空にする）か、`apps/web` からの作成（`createItem` 経由。RDS + DynamoDB を両方書く）だけで一覧を確認する。
- **`apps/api` をローカルの `node --watch src/main.ts` で実 AWS の RDS に繋ぐには `DB_HOST=localhost DB_PORT=5432`（`just db-tunnel` の SSM トンネル経由）を環境変数で渡す。** 未設定なら Secrets Manager の secret に入っている本番相当のホスト名（ECS/Fargate 用）にそのまま繋ぎに行き、ローカルからは到達できない。
