resource "aws_ecs_cluster" "app" {
  name = var.project_name
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project_name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${data.terraform_remote_state.platform.outputs.ecr_repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = var.app_port, protocol = "tcp" }
      ]
      environment = [
        { name = "PORT", value = tostring(var.app_port) },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "DB_SECRET_ARN", value = data.terraform_remote_state.data_layer.outputs.db_secret_arn },
        { name = "ITEMS_TABLE_NAME", value = data.terraform_remote_state.platform.outputs.items_table_name },
        { name = "ITEMS_QUEUE_URL", value = data.terraform_remote_state.platform.outputs.items_queue_url },
        { name = "COGNITO_USER_POOL_ID", value = data.terraform_remote_state.platform.outputs.cognito_user_pool_id },
        { name = "COGNITO_CLIENT_ID", value = data.terraform_remote_state.platform.outputs.cognito_user_pool_client_id },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "${var.project_name}-api"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.terraform_remote_state.network.outputs.private_subnet_ids
    security_groups  = [data.terraform_remote_state.network.outputs.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.app_port
  }

  # deploy-api.yml が新リビジョンを登録して task_definition を差し替えるため、Terraform の state とのずれを無視する。
  # 新規作成（just up）では image_tag 付きのタスク定義が使われるので影響しない。
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.project_name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${data.terraform_remote_state.platform.outputs.ecr_repository_url}:${var.image_tag}"
      essential = true
      # api/worker は同じイメージ。command で worker のエントリポイントに切り替える。
      command = ["node", "apps/worker/src/main.ts"]
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "DB_SECRET_ARN", value = data.terraform_remote_state.data_layer.outputs.db_secret_arn },
        { name = "ITEMS_TABLE_NAME", value = data.terraform_remote_state.platform.outputs.items_table_name },
        { name = "ITEMS_QUEUE_URL", value = data.terraform_remote_state.platform.outputs.items_queue_url },
        { name = "APP_BUCKET_NAME", value = data.terraform_remote_state.platform.outputs.app_bucket },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "worker" {
  name            = "${var.project_name}-worker"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.terraform_remote_state.network.outputs.private_subnet_ids
    security_groups  = [data.terraform_remote_state.network.outputs.ecs_security_group_id]
    assign_public_ip = false
  }

  # deploy-api.yml が新リビジョンを登録して task_definition を差し替えるため、Terraform の state とのずれを無視する。
  lifecycle {
    ignore_changes = [task_definition]
  }
}
