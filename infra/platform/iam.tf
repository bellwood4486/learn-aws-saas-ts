# GitHub Actions が OIDC でこのアカウントのロールを assume するための ID プロバイダ。
# アカウントに同じ URL のものは 1 つしか作れないため、既に存在する場合は terraform import で取り込む。
# thumbprint は AWS が GitHub の証明書を自動で検証するので指定しない。
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# platform 層の 2 ロールに共通の信頼ポリシー。main ブランチで動く workflow だけが assume できる。
# workflow_run / workflow_dispatch のどちらで起動しても、main 上の実行なら sub は同じ形になる。
data "aws_iam_policy_document" "github_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

# --- github_publish: publish-image.yml が ECR にイメージを発行する ---

resource "aws_iam_role" "github_publish" {
  name               = "${var.project_name}-github-publish"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
}

data "aws_iam_policy_document" "github_publish" {
  # GetAuthorizationToken はリソース指定ができない
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # DescribeImages は「同じタグが発行済みなら push をスキップする」ために使う
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeImages",
    ]
    resources = [aws_ecr_repository.app.arn]
  }
}

resource "aws_iam_role_policy" "github_publish" {
  name   = "${var.project_name}-github-publish"
  role   = aws_iam_role.github_publish.id
  policy = data.aws_iam_policy_document.github_publish.json
}

# --- github_deploy_api: deploy-api.yml が発行済みイメージを ECS に反映する ---
# app 層（ECS / IAM ロール）はセッション毎に destroy されるため、このロールは常時起動層の platform に置く。

resource "aws_iam_role" "github_deploy_api" {
  name               = "${var.project_name}-github-deploy-api"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
}

data "aws_iam_policy_document" "github_deploy_api" {
  statement {
    sid       = "EcrCheckImage"
    actions   = ["ecr:DescribeImages"]
    resources = [aws_ecr_repository.app.arn]
  }

  # RegisterTaskDefinition / DescribeTaskDefinition はリソースレベルの権限指定に対応していないため "*"
  statement {
    sid       = "EcsTaskDefinition"
    actions   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
    resources = ["*"]
  }

  statement {
    sid     = "EcsService"
    actions = ["ecs:DescribeServices", "ecs:UpdateService"]
    resources = [
      "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${var.project_name}/${var.project_name}-*",
    ]
  }

  # app 層のロール（-ecs-execution / -api-task / -worker-task）は destroy 済みで存在しない時期があるため、
  # ARN ではなく名前パターンで絞る。ecs-tasks にしか渡せないよう iam:PassedToService で限定する。
  statement {
    sid       = "PassTaskRoles"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_deploy_api" {
  name   = "${var.project_name}-github-deploy-api"
  role   = aws_iam_role.github_deploy_api.id
  policy = data.aws_iam_policy_document.github_deploy_api.json
}
