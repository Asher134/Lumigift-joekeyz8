terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — store in S3 + DynamoDB lock table
  # Replace bucket/table names before first apply
  backend "s3" {
    bucket         = "lumigift-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "lumigift-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# ─── PostgreSQL (RDS) ─────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "lumigift-${var.env}"
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier             = "lumigift-${var.env}"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = var.db_instance_class
  allocated_storage      = 20
  db_name                = "lumigift"
  username               = "lumigift"
  password               = var.db_password   # injected from secret store — never hardcoded
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  skip_final_snapshot    = var.env != "prod"
  deletion_protection    = var.env == "prod"
  storage_encrypted      = true

  # ── #104: Automated backups & PITR ─────────────────────────────────────────
  backup_retention_period = 30               # days — enables PITR for the full window
  backup_window           = "02:00-03:00"    # UTC, during low-traffic hours
  maintenance_window      = "sun:03:00-sun:04:00"
  copy_tags_to_snapshot   = true

  tags = local.tags
}

# ─── #104: S3 bucket for encrypted pg_dump off-site backups ──────────────────

resource "aws_s3_bucket" "backups" {
  bucket        = "lumigift-backups-${var.env}"
  force_destroy = var.env != "prod"

  tags = local.tags
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expire-postgres-backups"
    status = "Enabled"
    filter { prefix = "postgres/" }
    expiration { days = 30 }
  }
}

# ─── #104: IAM user + restricted policy for CI backup job ────────────────────

resource "aws_iam_user" "backup_runner" {
  name = "lumigift-backup-${var.env}"
  tags = local.tags
}

resource "aws_iam_access_key" "backup_runner" {
  user = aws_iam_user.backup_runner.name
}

resource "aws_iam_user_policy" "backup_runner" {
  name = "lumigift-backup-s3-${var.env}"
  user = aws_iam_user.backup_runner.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowBackupUpload"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.backups.arn,
          "${aws_s3_bucket.backups.arn}/postgres/*"
        ]
      },
      {
        Sid    = "AllowKMSForBackupBucket"
        Effect = "Allow"
        Action = [
          "kms:GenerateDataKey",
          "kms:Decrypt"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "s3.${var.aws_region}.amazonaws.com"
          }
        }
      }
    ]
  })
}

# ─── #104: SNS topic for backup failure alerts ────────────────────────────────

resource "aws_sns_topic" "backup_alerts" {
  name = "lumigift-db-backup-alerts-${var.env}"
  tags = local.tags
}

resource "aws_sns_topic_subscription" "backup_alerts_email" {
  topic_arn = aws_sns_topic.backup_alerts.arn
  protocol  = "email"
  endpoint  = var.ops_alert_email
}

resource "aws_rds_event_subscription" "backup_events" {
  name      = "lumigift-backup-events-${var.env}"
  sns_topic = aws_sns_topic.backup_alerts.arn

  source_type      = "db-instance"
  source_ids       = [aws_db_instance.postgres.identifier]
  event_categories = ["backup", "notification", "failure"]

  tags = local.tags
}

# ─── Redis (ElastiCache) ──────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "lumigift-${var.env}"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "lumigift-${var.env}"
  engine               = "redis"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  tags = local.tags
}

# ─── Compute — App Runner (serverless Next.js) ────────────────────────────────

resource "aws_iam_role" "app_runner_instance_role" {
  name = "lumigift-${var.env}-apprunner-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "tasks.apprunner.amazonaws.com"
        }
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "secrets_access" {
  name = "lumigift-${var.env}-secrets-access"
  role = aws_iam_role.app_runner_instance_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.db_url.arn,
          aws_secretsmanager_secret.redis_url.arn,
          aws_secretsmanager_secret.nextauth_secret.arn,
          aws_secretsmanager_secret.nextauth_secret_previous.arn,
          aws_secretsmanager_secret.csrf_secret.arn,
          aws_secretsmanager_secret.cron_secret.arn,
          aws_secretsmanager_secret.stellar_server_secret_key.arn,
          aws_secretsmanager_secret.stellar_escrow_contract_id.arn,
          aws_secretsmanager_secret.paystack_secret_key.arn,
          aws_secretsmanager_secret.stripe_secret_key.arn,
          aws_secretsmanager_secret.stripe_webhook_secret.arn,
          aws_secretsmanager_secret.termii_api_key.arn,
          aws_secretsmanager_secret.cloudinary_api_secret.arn,
          aws_secretsmanager_secret.cloudinary_api_key.arn
        ]
      }
    ]
  })
}

resource "aws_apprunner_service" "app" {
  service_name = "lumigift-${var.env}"

  source_configuration {
    image_repository {
      image_identifier      = var.app_image
      image_repository_type = "ECR"
      image_configuration {
        port = "3000"
        runtime_environment_secrets = {
          DATABASE_URL                 = aws_secretsmanager_secret.db_url.arn
          REDIS_URL                    = aws_secretsmanager_secret.redis_url.arn
          NEXTAUTH_SECRET              = aws_secretsmanager_secret.nextauth_secret.arn
          NEXTAUTH_SECRET_PREVIOUS     = aws_secretsmanager_secret.nextauth_secret_previous.arn
          CSRF_SECRET                  = aws_secretsmanager_secret.csrf_secret.arn
          CRON_SECRET                  = aws_secretsmanager_secret.cron_secret.arn
          STELLAR_SERVER_SECRET_KEY     = aws_secretsmanager_secret.stellar_server_secret_key.arn
          STELLAR_ESCROW_CONTRACT_ID   = aws_secretsmanager_secret.stellar_escrow_contract_id.arn
          PAYSTACK_SECRET_KEY          = aws_secretsmanager_secret.paystack_secret_key.arn
          STRIPE_SECRET_KEY             = aws_secretsmanager_secret.stripe_secret_key.arn
          STRIPE_WEBHOOK_SECRET         = aws_secretsmanager_secret.stripe_webhook_secret.arn
          TERMII_API_KEY               = aws_secretsmanager_secret.termii_api_key.arn
          CLOUDINARY_API_SECRET        = aws_secretsmanager_secret.cloudinary_api_secret.arn
          CLOUDINARY_API_KEY           = aws_secretsmanager_secret.cloudinary_api_key.arn
        }
      }
    }
    auto_deployments_enabled = true
  }

  instance_configuration {
    cpu               = "1024"
    memory            = "2048"
    instance_role_arn = aws_iam_role.app_runner_instance_role.arn
  }

  tags = local.tags
}

# ─── DNS (Route 53) ───────────────────────────────────────────────────────────

data "aws_route53_zone" "main" {
  name = var.domain_name
}

resource "aws_route53_record" "app" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.env == "prod" ? var.domain_name : "${var.env}.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [aws_apprunner_service.app.service_url]
}

# ─── Secrets (AWS Secrets Manager) ───────────────────────────────────────────
# Secrets are provisioned empty or rotated programmatically; values are injected
# out-of-band via AWS CLI / CI secrets pipeline — never stored in Terraform state as plaintext.

resource "aws_secretsmanager_secret" "db_url" {
  name                    = "lumigift/${var.env}/DATABASE_URL"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "lumigift/${var.env}/REDIS_URL"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "nextauth_secret" {
  name                    = "lumigift/${var.env}/NEXTAUTH_SECRET"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "nextauth_secret_previous" {
  name                    = "lumigift/${var.env}/NEXTAUTH_SECRET_PREVIOUS"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "csrf_secret" {
  name                    = "lumigift/${var.env}/CSRF_SECRET"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "cron_secret" {
  name                    = "lumigift/${var.env}/CRON_SECRET"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "stellar_server_secret_key" {
  name                    = "lumigift/${var.env}/STELLAR_SERVER_SECRET_KEY"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "stellar_escrow_contract_id" {
  name                    = "lumigift/${var.env}/STELLAR_ESCROW_CONTRACT_ID"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "paystack_secret_key" {
  name                    = "lumigift/${var.env}/PAYSTACK_SECRET_KEY"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "stripe_secret_key" {
  name                    = "lumigift/${var.env}/STRIPE_SECRET_KEY"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "stripe_webhook_secret" {
  name                    = "lumigift/${var.env}/STRIPE_WEBHOOK_SECRET"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "termii_api_key" {
  name                    = "lumigift/${var.env}/TERMII_API_KEY"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "cloudinary_api_secret" {
  name                    = "lumigift/${var.env}/CLOUDINARY_API_SECRET"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret" "cloudinary_api_key" {
  name                    = "lumigift/${var.env}/CLOUDINARY_API_KEY"
  recovery_window_in_days = 7
  tags                    = local.tags
}

# ─── Security Groups ──────────────────────────────────────────────────────────

resource "aws_security_group" "db" {
  name   = "lumigift-${var.env}-db"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  tags = local.tags
}

resource "aws_security_group" "redis" {
  name   = "lumigift-${var.env}-redis"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  tags = local.tags
}

resource "aws_security_group" "app" {
  name   = "lumigift-${var.env}-app"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

# ─── Locals ───────────────────────────────────────────────────────────────────

locals {
  tags = {
    Project     = "lumigift"
    Environment = var.env
    ManagedBy   = "terraform"
  }
}

