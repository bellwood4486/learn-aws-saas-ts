# app

セッション毎に作り直すapp層。ECS Fargate（api/workerサービス）とALB（apiのみ）を持つ。

## 依存

- `infra/bootstrap/`（tfstateバケット）
- `infra/network/`（VPC・subnet・SG。`ecs`SGはM2で作成済みでALBからのapp_port ingress・RDS/HTTPS egressを既に満たすため変更不要）
- `infra/platform/`（ECRリポジトリ・DynamoDBテーブル・SQSキュー・S3バケット。M4でARN出力を2つ追加した）
- `infra/data/`（RDSのDB認証情報シークレット）

## image_tag について

ECRリポジトリは`image_tag_mutability = "IMMUTABLE"`（M1で決定済み）のため、`latest`のような使い回しタグは使えない。`var.image_tag`にデフォルトは無く、commit SHAを明示的に渡す必要がある。

- `just up` / `just tf-apply app` / `just tf-destroy app` を単独で使う場合は、事前に環境変数で渡す:
  ```
  TF_VAR_image_tag="$(git rev-parse --short HEAD)" just tf-apply app
  ```
- apply前に **その commit SHA のイメージが ECR に push 済み** であること（`just image-build && just image-push`）。未pushのタグを指定すると、ECS タスクは `CannotPullContainerError` で起動に失敗する

## 出力

| 名前 | 用途 |
|---|---|
| `alb_dns_name` | ALB の DNS 名。curl での動作確認、M7 で edge 層が CloudFront オリジンとして使う |
| `ecs_cluster_name` | ECS クラスタ名 |
| `aws_region` | 全層で共通のリージョン |

## 注意

- **セッション毎レイヤー。** 使い終わったら `just tf-destroy app` で必ず壊す（ALB $0.024/h + Fargate分が課金され続ける）
- **api サービスのみ ALB に紐付く。** worker は SQS をロングポーリングするだけなので ALB 不要
- **api/worker は同じ ECR イメージを共用し、ECS タスク定義の `command` で切り替える**（意図的な簡略化。M1 で ECR リポジトリを1つにしたことと対応する）
- **task role は api/worker で分離している。** api は DynamoDB(Put/Get)・SQS(Send)・Secrets Manager(db) のみ、worker は DynamoDB(Put)・S3(Put)・SQS(Receive/Delete)・Secrets Manager(db) のみを許可する。execution role（ECR pull・Logs書き込み）はビジネス権限を含まないため共用する
- **destroy 順序に注意。** `infra/network` が先に destroy されると `terraform_remote_state` の参照先が無くなり `app` の plan が壊れる。`app` → `data` → `network` の順で destroy する
