data "aws_caller_identity" "current" {}

# 層間の配線。tfstate バケット名は infra/bootstrap/main.tf と同じ規則で組み立てる
# （backend 側はバケット名を -backend-config で受け取るが、data source には渡らないため）。
data "terraform_remote_state" "network" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"
    key    = "network/terraform.tfstate"
    region = var.aws_region
  }
}

# AWS が公開する最新の Amazon Linux 2023 arm64 AMI。
# data.aws_ami の name filter は AMI 命名規則の変更で壊れるため使わない。
data "aws_ssm_parameter" "bastion_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}
