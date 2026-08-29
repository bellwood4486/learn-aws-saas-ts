# RDS のマスターパスワードは / @ " スペースを禁止する。
# デフォルトの override_special にはこれらが含まれ、validate は通るが apply で落ちる。
resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%^&*()-_=+[]{}<>:?"
}

# manage_master_user_password は使わない。RDS 所有のシークレットは Terraform リソースとして
# 持てず recovery window を制御できないため、just down のたびに削除待ちシークレットが
# $0.40/月 ずつ残る恐れがある。自前で持てば recovery_window_in_days = 0 で確実に消える。
resource "aws_secretsmanager_secret" "db" {
  name                    = "${var.project_name}/db"
  description             = "Connection info for the app database. Recreated every session."
  recovery_window_in_days = 0
}

# platform 層の app シークレットと違い ignore_changes は付けない。
# ここは random_password が Terraform 管理下にあり Terraform 側が正なので、
# ignore_changes を付けるとローテーション後に古いパスワードで固定されてしまう。
resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    host     = aws_db_instance.app.address
    port     = aws_db_instance.app.port
    dbname   = aws_db_instance.app.db_name
    username = aws_db_instance.app.username
    password = random_password.db.result
  })
}
