output "db_address" {
  description = "RDS のエンドポイントホスト名（ポートを含まない）。"
  value       = aws_db_instance.app.address
}

output "db_port" {
  description = "RDS のポート番号。"
  value       = aws_db_instance.app.port
}

output "db_name" {
  description = "初期作成されるデータベース名。"
  value       = aws_db_instance.app.db_name
}

output "db_username" {
  description = "マスターユーザー名（パスワードは出力しない）。"
  value       = aws_db_instance.app.username
}

output "db_instance_identifier" {
  description = "RDS インスタンスの識別子。"
  value       = aws_db_instance.app.identifier
}

output "db_secret_arn" {
  description = "DB 認証情報シークレットの ARN（値そのものは出力しない）。"
  value       = aws_secretsmanager_secret.db.arn
}

output "db_secret_name" {
  description = "DB 認証情報シークレットの名前。just db-url が参照する。"
  value       = aws_secretsmanager_secret.db.name
}

output "bastion_instance_id" {
  description = "SSM ポートフォワードの起点になる踏み台 EC2 のインスタンス ID。"
  value       = aws_instance.bastion.id
}

output "aws_region" {
  description = "全層で共通のリージョン。"
  value       = var.aws_region
}
