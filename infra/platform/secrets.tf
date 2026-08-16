resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.project_name}/app"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    api_key = "REPLACE_ME"
  })
}
