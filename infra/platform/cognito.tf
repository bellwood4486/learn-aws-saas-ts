resource "aws_cognito_user_pool" "app" {
  name = var.project_name

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  # 学習用の単一プロジェクトなので自己サインアップは無効にし、
  # テストユーザーは `aws cognito-idp admin-create-user` で作成する運用にする。
  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web"
  user_pool_id = aws_cognito_user_pool.app.id

  # apps/web はブラウザから直接呼ぶパブリッククライアントなのでシークレットは発行しない。
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH", # M5の動作確認（admin-initiate-auth）で使う
    "ALLOW_USER_PASSWORD_AUTH",       # M6でapps/webがユーザー名+パスワードで直接ログインするために使う
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}
