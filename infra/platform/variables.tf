variable "aws_region" {
  description = "リソースを作る AWS リージョン。"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "リソース名のプレフィックスとして使うプロジェクト名。"
  type        = string
  default     = "learn-aws-saas-ts"
}

variable "github_subject_prefix" {
  description = "CI/CD 用ロールの信頼ポリシー（sub 条件）に使う、GitHub の OIDC `sub` クレームの接頭辞。`repo:<owner>@<owner_id>/<repo>@<repo_id>` の形（リポジトリの OIDC 設定が不変サブジェクトのとき。GitHub の新しい既定値）。デフォルト無し。値は `just gh-subject-prefix` で取得し、git 管理外の `.mise.local.toml` の `TF_VAR_github_subject_prefix` に設定する。terraform を直接叩くときも同じ環境変数を渡す。"
  type        = string

  validation {
    condition     = can(regex("^repo:[^/:@]+(@[0-9]+)?/[^/:@]+(@[0-9]+)?$", var.github_subject_prefix))
    error_message = "github_subject_prefix は repo:<owner>@<owner_id>/<repo>@<repo_id> の形式で指定してください（just gh-subject-prefix で取得できます）。"
  }
}
