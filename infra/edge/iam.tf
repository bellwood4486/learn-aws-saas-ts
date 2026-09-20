# platform 層が作った GitHub OIDC provider を URL で引く（terraform_remote_state は増やさない）。
# provider が無いと plan が失敗するので、apply 順は platform → edge。
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# main ブランチで動く workflow だけが assume できる（platform 層の 2 ロールと同じ条件）。
# sub は GitHub の OIDC の sub クレームの接頭辞（var.github_subject_prefix。不変サブジェクトなら所有者/リポジトリの ID 入り）
# + `:ref:refs/heads/main`。名前ではなく ID で固定するので、リポジトリのリネームや同名での作り直しに乗っ取られない。
data "aws_iam_policy_document" "github_deploy_web_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_subject_prefix}:ref:refs/heads/main"]
    }
  }
}

# deploy-web.yml がビルド成果物を S3 に同期し、CloudFront のキャッシュを invalidate する。
resource "aws_iam_role" "github_deploy_web" {
  name               = "${var.project_name}-github-deploy-web"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_web_trust.json
}

data "aws_iam_policy_document" "github_deploy_web" {
  statement {
    sid       = "ListBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.web.arn]
  }

  # aws s3 sync --delete が使う
  statement {
    sid       = "SyncObjects"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
  }

  statement {
    sid       = "Invalidate"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.web.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy_web" {
  name   = "${var.project_name}-github-deploy-web"
  role   = aws_iam_role.github_deploy_web.id
  policy = data.aws_iam_policy_document.github_deploy_web.json
}
