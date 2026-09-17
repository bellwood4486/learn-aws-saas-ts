# edge

常時起動するedge層。フロント配信用の非公開S3バケットと、OAC付きCloudFront（2オリジン）を持つ。

## 依存

- `infra/bootstrap/`（tfstateバケット）
- `infra/app/`（ALBのDNS名。`var.alb_dns_name`として明示的に渡す。`terraform_remote_state`は使わない）

## `var.alb_dns_name` について

app層が未apply、またはdestroy済みのときはこの変数を空文字のままにする（デフォルト）。
`/api/*` のオリジンとキャッシュビヘイビアは空文字なら作られない。

- `just up` はapp層apply後、この層を `terraform apply -var="alb_dns_name=<ALBのDNS名>"` で再applyする
- `just down` はapp層をdestroyする前に、この層を `terraform apply -var="alb_dns_name="` で再applyし、
  distributionが死んだALBを指したまま残らないようにする
- 単独で `just tf-apply edge` する場合、ALBのDNS名を渡したいときは
  `TF_VAR_alb_dns_name="$(cd infra/app && terraform output -raw alb_dns_name)" just tf-apply edge` のように実行する

## CloudFrontのdestroyについて

この層は常時起動なので通常destroyしない。CloudFrontのdistributionはdisable→伝播待ち→削除と進み時間がかかる
（時間課金が無いため消す金銭的な意味もない）。

## 実機検証で判明した挙動（初回apply）

- **初回のdistribution作成（`Deployed`になるまで）は実測3分弱だった。** 設計時の見積もり（15〜30分）より大幅に速い。`aws_cloudfront_distribution.web: Creation complete after 2m47s` の直後に `aws cloudfront wait distribution-deployed` も即座に成功した
- **新規worktreeでは他層（`infra/bootstrap`・`infra/platform`等）も含めて`terraform init`をやり直す必要がある。** `.terraform/`配下のprovider pluginキャッシュはgit管理外かつworktreeごとに独立しているため、既存worktreeで済ませていても新しいworktreeでは各層で再度`terraform init`が要る
- `just web-deploy`実行前に`apps/web/.env.local`が無い場合、`.env.template`からコピーして`VITE_COGNITO_CLIENT_ID`を`infra/platform`の`terraform output -raw cognito_user_pool_client_id`の値に置き換える（M6と同じ手順）
