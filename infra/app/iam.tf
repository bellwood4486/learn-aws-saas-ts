data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# execution role は ECR pull / CloudWatch Logs 書き込みのみで、ビジネス権限を含まないため api/worker で共用する。
resource "aws_iam_role" "execution" {
  name               = "${var.project_name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# --- api task role: createItem(insert+put+send) / getItem(select+get) が使うAPIだけを許可 ---

resource "aws_iam_role" "api_task" {
  name               = "${var.project_name}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

data "aws_iam_policy_document" "api_task" {
  statement {
    sid       = "DynamoDbItems"
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem"]
    resources = [data.terraform_remote_state.platform.outputs.items_table_arn]
  }

  statement {
    sid       = "SqsSend"
    actions   = ["sqs:SendMessage"]
    resources = [data.terraform_remote_state.platform.outputs.items_queue_arn]
  }

  statement {
    sid       = "DbSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [data.terraform_remote_state.data_layer.outputs.db_secret_arn]
  }
}

resource "aws_iam_role_policy" "api_task" {
  name   = "${var.project_name}-api-task"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_task.json
}

# --- worker task role: processItem(select+put object+put) / SQS受信削除が使うAPIだけを許可 ---

resource "aws_iam_role" "worker_task" {
  name               = "${var.project_name}-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

data "aws_iam_policy_document" "worker_task" {
  statement {
    sid       = "DynamoDbItems"
    actions   = ["dynamodb:PutItem"]
    resources = [data.terraform_remote_state.platform.outputs.items_table_arn]
  }

  statement {
    sid       = "S3AppBucket"
    actions   = ["s3:PutObject"]
    resources = ["${data.terraform_remote_state.platform.outputs.app_bucket_arn}/*"]
  }

  statement {
    sid       = "SqsReceive"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [data.terraform_remote_state.platform.outputs.items_queue_arn]
  }

  statement {
    sid       = "DbSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [data.terraform_remote_state.data_layer.outputs.db_secret_arn]
  }
}

resource "aws_iam_role_policy" "worker_task" {
  name   = "${var.project_name}-worker-task"
  role   = aws_iam_role.worker_task.id
  policy = data.aws_iam_policy_document.worker_task.json
}
