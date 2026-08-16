resource "aws_subnet" "public_1a" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.0.0.0/20"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-1a"
  }
}

resource "aws_subnet" "public_1c" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.0.16.0/20"
  availability_zone       = "${var.aws_region}c"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-1c"
  }
}

resource "aws_subnet" "private_1a" {
  vpc_id            = aws_vpc.app.id
  cidr_block        = "10.0.32.0/20"
  availability_zone = "${var.aws_region}a"

  tags = {
    Name = "${var.project_name}-private-1a"
  }
}

resource "aws_subnet" "private_1c" {
  vpc_id            = aws_vpc.app.id
  cidr_block        = "10.0.48.0/20"
  availability_zone = "${var.aws_region}c"

  tags = {
    Name = "${var.project_name}-private-1c"
  }
}
