data "aws_caller_identity" "current" {}

data "terraform_remote_state" "network" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"
    key    = "network/terraform.tfstate"
    region = var.aws_region
  }
}

data "terraform_remote_state" "platform" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"
    key    = "platform/terraform.tfstate"
    region = var.aws_region
  }
}

data "terraform_remote_state" "data_layer" {
  backend = "s3"

  config = {
    bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"
    key    = "data/terraform.tfstate"
    region = var.aws_region
  }
}
