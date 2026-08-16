resource "aws_sqs_queue" "items_dlq" {
  name = "${var.project_name}-items-dlq"
}

resource "aws_sqs_queue" "items" {
  name                       = "${var.project_name}-items"
  visibility_timeout_seconds = 30

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.items_dlq.arn
    maxReceiveCount     = 3
  })
}
