data "aws_iam_policy_document" "bastion_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bastion" {
  name               = "${var.project_name}-bastion"
  description        = "Role for the SSM bastion host. SSM core access only."
  assume_role_policy = data.aws_iam_policy_document.bastion_assume_role.json
}

# 付けるのは AmazonSSMManagedInstanceCore のみ。踏み台は SSM の管理対象になる以外の権限を持たない。
resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  name = "${var.project_name}-bastion"
  role = aws_iam_role.bastion.name
}

# private subnet に置き、パブリック IP も SSH 鍵も持たない。
# SSM Agent は NAT Gateway 経由で SSM エンドポイントに接続しに行く（VPC エンドポイントは M9 で比較）。
resource "aws_instance" "bastion" {
  ami                         = data.aws_ssm_parameter.bastion_ami.value
  instance_type               = var.bastion_instance_type
  subnet_id                   = data.terraform_remote_state.network.outputs.private_subnet_ids[0]
  vpc_security_group_ids      = [data.terraform_remote_state.network.outputs.bastion_security_group_id]
  iam_instance_profile        = aws_iam_instance_profile.bastion.name
  associate_public_ip_address = false

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_size = 8
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${var.project_name}-bastion"
  }
}
