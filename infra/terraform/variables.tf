variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "env" {
  description = "Deployment environment (prod | staging)"
  type        = string
  default     = "prod"
}

variable "vpc_id" {
  description = "VPC ID for all resources"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for RDS and ElastiCache"
  type        = list(string)
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_password" {
  description = "RDS master password — supply via TF_VAR_db_password env var, never hardcode"
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

variable "app_image" {
  description = "ECR image URI for the Next.js app (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/lumigift:latest)"
  type        = string
}

variable "domain_name" {
  description = "Root domain name managed in Route 53 (e.g. lumigift.app)"
  type        = string
}

# ─── #104: Backup automation variables ───────────────────────────────────────

variable "ops_alert_email" {
  description = "Email address that receives backup failure SNS alerts"
  type        = string
  default     = "ops@lumigift.app"
}

# ─── #335: Vercel variables ──────────────────────────────────────────────────

variable "vercel_team_id" {
  description = "Vercel team ID or slug that owns the project"
  type        = string
}

variable "vercel_project_name" {
  description = "Vercel project name"
  type        = string
  default     = "lumigift"
}

variable "vercel_git_repo" {
  description = "GitHub repository linked to the Vercel project (owner/name)"
  type        = string
}

variable "vercel_env_secret_id" {
  description = "AWS Secrets Manager secret ID holding Vercel env var values as a JSON object"
  type        = string
}

variable "vercel_env_keys" {
  description = "Environment variable keys managed on the Vercel project; values come from vercel_env_secret_id"
  type        = list(string)
  default     = []
}
