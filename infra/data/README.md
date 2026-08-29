# data

セッション毎に作り直すデータ層。RDS PostgreSQL・DB 認証情報シークレット・SSM 踏み台 EC2 を持つ。**この層だけがステートフル**（RDS のデータは destroy で消える。踏み台はステートレス）。

## 依存

- `infra/bootstrap/`（tfstate バケット。`just tf-apply data` が `-backend-config` で自動的に配線する）
- `infra/network/`（`terraform_remote_state` で `private_subnet_ids` / `rds_security_group_id` / `bastion_security_group_id` を読む。**network を先に apply していないと plan がわかりにくいエラーで落ちる**）

## 出力

| 名前 | 用途 |
|---|---|
| `db_address` | RDS のエンドポイントホスト名 |
| `db_port` | RDS のポート番号 |
| `db_name` | 初期データベース名（`app`） |
| `db_username` | マスターユーザー名（`app`） |
| `db_instance_identifier` | RDS インスタンス識別子 |
| `db_secret_arn` | DB 認証情報シークレットの ARN |
| `db_secret_name` | 同シークレットの名前（`just db-url` が参照） |
| `bastion_instance_id` | SSM ポートフォワードの起点になる踏み台の ID |
| `aws_region` | 全層で共通のリージョン |

**パスワードは output しない。** Secrets Manager とこの層の tfstate の中だけに存在する。

## 接続手順（SSM ポートフォワード）

RDS は private subnet にあり、パブリックアクセスも無効なので、ローカルからは直接繋がらない。`AWS-StartPortForwardingSessionToRemoteHost` は **SSM 管理下のインスタンスを起点に** 任意の `host:port` へフォワードする仕組みで、RDS 自体は SSM 管理ノードになれない。そのため踏み台 EC2 が要る（ECS Exec は interactive command のみでポートフォワードに非対応なので、M4 を待っても解決しない）。

**事前準備: `session-manager-plugin`。** `aws ssm start-session`（`just db-tunnel`）は AWS CLI 本体とは別のプラグインバイナリを必要とする。mise の `awscli` パッケージはこれを含まないため、`mise install` だけでは足りない。`brew install --cask session-manager-plugin` で別途インストールすること（未インストールだと `SessionManagerPlugin is not found` で失敗する）。

実機検証では踏み台は `just tf-apply data` 完了直後から `aws ssm describe-instance-information` 上で `Online` になっており、待機は不要だった。`tf-apply data` の所要時間は RDS インスタンス本体の作成（~7分）が支配的（`network` 30 リソース作成に対し `data` は 10 リソース）。

ターミナル1（トンネルを張る。開いたままにする）:

```console
$ just db-tunnel
```

ターミナル2（migration / seed / 接続確認）:

```console
$ just db-migrate
$ just db-seed
$ just db-check
```

`db-seed` は idempotent（実機検証で再実行しても件数は増えず `items rows: 2` のまま）。`db-check` のテーブル一覧は `table_schema = 'public'` を見ているため `items` しか出ない。Drizzle の migration 管理テーブル `__drizzle_migrations` は `drizzle` スキーマに作られるので、この一覧に出ないのは想定どおり（テーブルが消えているわけではない）。

`psql` を使う場合（`psql` は mise 管理外。未インストールなら `brew install libpq`）:

```console
$ just db-psql
```

**`just db-url` が返す接続文字列は `sslmode=require` ではなく `sslmode=no-verify` を使う。** pg（node-postgres）は接続文字列に書かれた `sslmode` の値で明示的な ssl オプションを上書きしてしまう実装になっており、`require` だと「証明書検証あり」に解決される。RDS の CA バンドルを取得しない方針の下でこれをやると、SSM トンネル越しに host が `localhost` になった瞬間に証明書・ホスト名検証で必ず失敗する。`no-verify` は pg-connection-string の拡張で `rejectUnauthorized: false` 相当になり、TLS は必須のまま証明書検証だけ諦める。psql（libpq）は `no-verify` を解さないので、`db-psql` だけは別途 `PGSSLMODE=require` で接続する（psql 版の同じトレードオフは下の「注意」に既出）。

## 注意

- **セッション毎レイヤー。** 使い終わったら `just tf-destroy data` で必ず壊す（`just down` は app → data → network の順に destroy する）。RDS `db.t4g.micro` は ~$0.02/h、踏み台 t4g.nano は僅少だが、消し忘れると踏み台だけで ~$3/月
- **destroy 順序。** `data` は `network` の SG/subnet を参照しているので、`network` を先に destroy してはいけない（`DependencyViolation` で失敗し、NAT Gateway と EIP が残って課金が続く）
- **RDS のデータは destroy で消える。** スキーマは Drizzle の migration（`just db-migrate`）、初期データは `just db-seed` で毎回流し直す
- **`manage_master_user_password` を使わない理由。** RDS が所有するシークレットは Terraform のリソースとして持てず recovery window を制御できないため、destroy のたびに削除待ちのシークレットが $0.40/月 ずつ残る恐れがある。`random_password` + 自前の `aws_secretsmanager_secret`（`recovery_window_in_days = 0`）なら destroy で確実に消え、状態が決定的になる。代償は「パスワードが tfstate に平文で載る」こと（tfstate バケットは SSE-S3 + public access block 済み）。実機検証でも `just tf-destroy data` 後の `just leaks` でこの DB シークレットの削除待ちは残らず、`recovery_window_in_days = 0` の効果を確認済み
- **`random_password` の記号制約。** RDS のマスターパスワードは `/` `@` `"` スペースを禁止する。`override_special` で明示的に除外している。`terraform validate` は通り `apply` で落ちるので気づきにくい
- **`rds.force_ssl = 1`。** クライアントは TLS 必須。Node（`just db-url` が組み立てる接続文字列）は `sslmode=no-verify`、psql（`just db-psql`）は `PGSSLMODE=require` を使う（理由は上の「接続手順」参照。`verify-full` は RDS の CA 証明書バンドル取得が要るので採らない。どちらも経路暗号化のみ担保する落とし所）。この値は静的パラメータではなく動的パラメータで（`aws rds describe-db-parameters` の `ApplyType: dynamic`）、PostgreSQL 16 以降はエンジン既定値が既に `1` のため `--source user` で見ると空リストになる（既定値と同じ値を設定した場合の正しい挙動で、パラメータが効いていないわけではない）。`SHOW rds.force_ssl` はセッション内では `unrecognized configuration parameter` になり使えないので、確認は `describe-db-parameters` か実際に平文接続を試す方法による。実機検証では `sslmode=disable` で接続を試みると `no pg_hba.conf entry for host "10.0.35.20"（踏み台の private IP）, user "app", database "app", no encryption` で拒否され、TLS 強制を実地で確認した
- **踏み台の SG は `infra/network/` にある。** M2 の慣習どおり SG という「箱」は network 層。ingress は持たず、egress は 443（SSM エンドポイント）と RDS SG 宛て 5432（ポートフォワードの実体）の2本。設計ドキュメントは「egress は 443 のみ」と書いているが、Terraform が既定の全許可 egress を削除するため、5432 が無いとポートフォワードがタイムアウトする
- **AMI は SSM Parameter Store 参照。** `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64` を読むので常に最新の Amazon Linux 2023 arm64 になる。踏み台は使い捨てなので AMI が変わっても困らない
