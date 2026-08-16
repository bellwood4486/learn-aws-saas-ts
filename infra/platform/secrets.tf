resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.project_name}/app"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    api_key = "REPLACE_ME"
  })

  # M4 以降、実キーは AWS CLI/コンソールから直接投入する運用にする。
  # ignore_changes がないと次の terraform apply で secret_string がこのダミー値に巻き戻る。
  lifecycle {
    ignore_changes = [secret_string]
  }
}
