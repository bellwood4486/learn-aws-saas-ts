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

variable "github_repository" {
  description = "CI/CD 用ロールの信頼ポリシー（sub 条件）に使う GitHub リポジトリ（<owner>/<repo>）。デフォルト無し。justfile が origin の URL から TF_VAR_github_repository として導出して渡すので、terraform を直接叩くときは同じ環境変数を渡す。"
  type        = string

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repository))
    error_message = "github_repository は <owner>/<repo> の形式で指定してください。"
  }
}
