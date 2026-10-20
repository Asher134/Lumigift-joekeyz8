output "app_url" {
  description = "App Runner service URL"
  value       = aws_apprunner_service.app.service_url
}

output "db_endpoint" {
  description = "RDS endpoint"
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
  sensitive   = true
}

# ─── #104: Backup outputs ─────────────────────────────────────────────────────

output "backup_bucket_name" {
  description = "S3 bucket used for encrypted pg_dump backups"
  value       = aws_s3_bucket.backups.id
}

output "backup_iam_access_key_id" {
  description = "Access key ID for the backup IAM user (store in GitHub Actions secret BACKUP_AWS_ACCESS_KEY_ID)"
  value       = aws_iam_access_key.backup_runner.id
  sensitive   = true
}

output "backup_iam_secret_access_key" {
  description = "Secret access key for the backup IAM user (store in GitHub Actions secret BACKUP_AWS_SECRET_ACCESS_KEY)"
  value       = aws_iam_access_key.backup_runner.secret
  sensitive   = true
}

output "backup_sns_topic_arn" {
  description = "SNS topic ARN for backup failure alerts"
  value       = aws_sns_topic.backup_alerts.arn
}
