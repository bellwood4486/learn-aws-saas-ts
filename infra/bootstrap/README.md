# bootstrap

全層の tfstate を保管する S3 バケットを作る。**一度だけ apply し、local state をリポジトリに commit する。**

このバケット自身を backend として使うことはできない（backend の設定にはバケットが先に存在している必要があるため）。他の5層（`platform` / `edge` / `network` / `data` / `app`）は、ここで作ったバケットを S3 backend として使う。

## 依存

なし（最初に apply する層）。

## 出力

| 名前 | 用途 |
|---|---|
| `tfstate_bucket` | 他層の `backend "s3" { bucket = ... }` に渡すバケット名 |
| `tfstate_bucket_arn` | バケットの ARN |
| `aws_region` | 全層で共通のリージョン |

## 注意

- `aws_s3_bucket.tfstate` に `lifecycle { prevent_destroy = true }` を付けている。全 tfstate の保管場所なので誤 destroy を防ぐため
- バージョニング・SSE-S3 暗号化・パブリックアクセスブロックを有効化済み
- ロックは各層の backend 設定で `use_lockfile = true` を使う（DynamoDB ロックテーブルはこの層でも作らない）
