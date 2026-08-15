# aws-saas-playground

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
| `just dev-all` | ローカルで api + web を同時起動（AWS のセッションを開かずに進められる） |

## コスト運用

月 $10 の予算アラートを前提に、常時起動する層（`platform` / `edge`）と、触るときだけ apply する層（`network` / `data` / `app`）を分けている。**セッションの終わりには必ず `just down` → `just leaks` → `just cost-report` を実行し、NAT Gateway / Elastic IP / ALB / RDS / 削除待ちシークレットが残っていないことを確認する。**

詳しい理由は spec ドキュメントの「シークレットと destroy 運用」を参照。
