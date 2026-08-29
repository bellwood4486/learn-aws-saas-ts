# network

セッション毎に作り直すネットワーク層。VPC・public/private subnet（2AZ）・IGW・NAT Gateway・route table・ALB/ECS/RDS用SGを持つ。

## 依存

- `infra/bootstrap/`（tfstate バケット。`just tf-plan network` / `just tf-apply network` / `just tf-destroy network` が `-backend-config` で自動的に配線する）

## 出力

| 名前 | 用途 |
|---|---|
| `vpc_id` | この層が作る VPC の ID |
| `public_subnet_ids` | ALB 配置用 public subnet の ID 一覧 |
| `private_subnet_ids` | ECS タスク・RDS 配置用 private subnet の ID 一覧 |
| `alb_security_group_id` | M4 で ALB に付与する SG の ID |
| `ecs_security_group_id` | M4 で ECS タスクに付与する SG の ID |
| `rds_security_group_id` | M3 で RDS に付与する SG の ID |
| `bastion_security_group_id` | M3 で SSM 踏み台 EC2 に付与する SG の ID |
| `nat_gateway_id` | NAT Gateway の ID（参考情報） |
| `aws_region` | 全層で共通のリージョン |

## 注意

- **セッション毎レイヤー。** 使い終わったら `just tf-destroy network` で必ず壊す。消し残すと NAT Gateway（~$0.062/h）と EIP（~$0.005/h）が課金され続ける。`just tf-destroy network` の後は必ず `just leaks` で NAT Gateway / EIP がゼロ件であることを確認する
- **ALB/ECS/RDS 自体のリソースはこの層には無い。** SG という「箱」と ingress ルールだけを VPC の一部として先に用意している。実際の ALB は M4、RDS は M3、ECS タスクは M4 で作り、それぞれこの層の SG ID を `terraform_remote_state` 経由で参照してアタッチする
- **bastion SG もこの層にある。** 踏み台 EC2 の実体（EC2・IAM ロール・instance profile）は `infra/data/` にあり、この層の `bastion_security_group_id` を `terraform_remote_state` 経由で参照する。ingress は持たない（SSM Agent が自分から HTTPS で出ていくだけ）。egress は 443（SSM エンドポイント）と RDS SG 宛て 5432（ポートフォワードの実体）の2本
- **NAT Gateway は 1 個のみ。** private subnet 1a/1c は共通の 1 つの private route table で NAT Gateway を共有する（マルチ AZ 冗長化はしない。コスト優先の学習環境のため）
- **`just up`/`just down` にはまだ組み込まれていない。** `infra/data`/`app`/`edge` が未実装のため。M3 で `data` の行、M4 で `app` の行、M7 で `edge` の行を段階的に追加する
- **「なぜ private subnet に NAT が要るのか」を確かめる演習（任意・手動）:** `aws_route.private_nat` を一時的に `terraform destroy -target=aws_route.private_nat` で消し、private subnet 内のリソースからの outbound（例: NAT 経由の ECR pull）が失敗することを確認する。確認後は `just tf-apply network` で `aws_route.private_nat` を作り直す
- **destroy 順序に注意。** `infra/data`（M3）・`infra/app`（M4）が実装され、それらが `terraform_remote_state` でこの層の SG/VPC 出力を参照するようになった後は、`just tf-destroy network` を先に実行してはいけない。SG/VPC に `DependencyViolation` で destroy が失敗し、NAT Gateway・EIP が壊れずに残って課金が続く。app/data を先に destroy してから network を壊す（将来 `just down` がこの層を組み込めば、それが安全な手順になる）。現時点（M3/M4 未実装）では `just tf-destroy network` を単独で実行して問題ない
