# edge

常時起動するedge層。フロント配信用の非公開S3バケットと、OAC付きCloudFront（2オリジン）を持つ。

## 依存

- `infra/bootstrap/`（tfstateバケット）
- `infra/app/`（ALBのDNS名。`var.alb_dns_name`として明示的に渡す。`terraform_remote_state`は使わない）
- `infra/platform/`（GitHub OIDC provider。`github_deploy_web` ロールの信頼ポリシーが data source で参照する。**apply 順は `platform/` → `edge/`**）

## `var.alb_dns_name` について

app層が未apply、またはdestroy済みのときはこの変数を空文字のままにする（デフォルト）。
`/api/*` のオリジンとキャッシュビヘイビアは空文字なら作られない。

- `just up` はapp層apply後、この層を `terraform apply -var="alb_dns_name=<ALBのDNS名>"` で再applyする
- `just down` はapp層をdestroyする前に、この層を `terraform apply -var="alb_dns_name="` で再applyし、
  distributionが死んだALBを指したまま残らないようにする
- 単独で `just tf-apply edge` する場合、ALBのDNS名を渡したいときは
  `TF_VAR_alb_dns_name="$(cd infra/app && terraform output -raw alb_dns_name)" just tf-apply edge` のように実行する

## CI/CD 用ロール

`github_deploy_web` は deploy-web.yml が OIDC で assume するロール。権限はこの層のバケットへの `s3:ListBucket` / `PutObject` / `DeleteObject` と、この distribution への `cloudfront:CreateInvalidation` だけ。信頼ポリシーの `sub` は `repo:<owner>@<owner_id>/<repo>@<repo_id>:ref:refs/heads/main` のみ（`repo:<owner>@<owner_id>/<repo>@<repo_id>` は `var.github_subject_prefix`。`.mise.local.toml` の `TF_VAR_github_subject_prefix` で渡す）。ARN は output `github_deploy_web_role_arn`。

## CloudFrontのdestroyについて

この層は常時起動なので通常destroyしない。CloudFrontのdistributionはdisable→伝播待ち→削除と進み時間がかかる
（時間課金が無いため消す金銭的な意味もない）。

## 実機検証で判明した挙動（初回apply）

- **初回のdistribution作成（`Deployed`になるまで）は実測3分弱だった。** 設計時の見積もり（15〜30分）より大幅に速い。`aws_cloudfront_distribution.web: Creation complete after 2m47s` の直後に `aws cloudfront wait distribution-deployed` も即座に成功した
- **新規worktreeでは他層（`infra/bootstrap`・`infra/platform`等）も含めて`terraform init`をやり直す必要がある。** `.terraform/`配下のprovider pluginキャッシュはgit管理外かつworktreeごとに独立しているため、既存worktreeで済ませていても新しいworktreeでは各層で再度`terraform init`が要る
- `just web-deploy`実行前に`apps/web/.env.local`が無い場合、`.env.template`からコピーして`VITE_COGNITO_CLIENT_ID`を`infra/platform`の`terraform output -raw cognito_user_pool_client_id`の値に置き換える（M6と同じ手順）

## 実機検証で判明した挙動（`just up`での通し確認）

- **`just up`の`edge`再applyの行にバグがあった（M7で修正済み）。** `cd infra/edge && terraform apply -var="alb_dns_name=$(cd infra/app && ...)"`は、`cd infra/edge`の直後に評価される`$(...)`内の`cd infra/app`がカレントディレクトリ`infra/edge`からの相対パスとして解決され`No such file or directory`で失敗し、`alb_dns_name`が常に空文字になっていた。`infra/edge`にリソースが無かった間（M7以前）は実害が無く気づかれなかったが、`/api/*`のオリジン/ビヘイビアが`var.alb_dns_name`で条件分岐するM7以降は致命的（`/api/*`が永久に生成されない）。`justfile`の該当行を`$(cd ../app && ...)`に修正した
- **新規worktreeでは`bootstrap`/`platform`/`network`/`data`/`app`/`edge`の全層で`terraform init`が必要。** `.terraform/`のprovider pluginキャッシュはgit管理外かつworktreeごとに独立するため
- **app層apply直後のRDSはmigration未適用。** `just up`はDrizzleのmigrationを含まないため、`GET /api/items`は`items`テーブルが無く500になる。`just db-tunnel`でトンネルを張り`just db-migrate`を実行してから動作確認する
- **CloudFrontのdistribution更新（ALBオリジン追加）は初回作成よりさらに速い。** `alb_dns_name`付きの再applyは約50秒で`Modifications complete`になった（初回作成の約3分弱よりも短い）
- ECS api/workerサービスは`aws ecs wait services-stable`で安定を待てる。今回の実測では数分以内に安定した
