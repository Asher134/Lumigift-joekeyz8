# ─── #335: Vercel project, domain and environment variables ──────────────────
#
# The frontend is deployed to Vercel. The project, custom domain and env var
# keys are managed here; secret values live in AWS Secrets Manager and are
# never committed. SSL certificates for the custom domain are issued and
# renewed automatically by Vercel once the domain is attached and DNS points
# at Vercel.

provider "vercel" {
  # Authenticate with the VERCEL_API_TOKEN environment variable.
  team = var.vercel_team_id
}

resource "vercel_project" "frontend" {
  name      = var.vercel_project_name
  framework = "nextjs"

  git_repository = {
    type              = "github"
    repo              = var.vercel_git_repo
    production_branch = "main"
  }
}

resource "vercel_project_domain" "frontend" {
  project_id = vercel_project.frontend.id
  domain     = var.domain_name
}

resource "vercel_project_domain" "frontend_www" {
  project_id           = vercel_project.frontend.id
  domain               = "www.${var.domain_name}"
  redirect             = vercel_project_domain.frontend.domain
  redirect_status_code = 308
}

# Secret values: a single JSON secret ({ "KEY": "value", ... }) in Secrets Manager.
data "aws_secretsmanager_secret_version" "vercel_env" {
  secret_id = var.vercel_env_secret_id
}

locals {
  vercel_env_values = jsondecode(data.aws_secretsmanager_secret_version.vercel_env.secret_string)
}

resource "vercel_project_environment_variable" "frontend" {
  for_each = toset(var.vercel_env_keys)

  project_id = vercel_project.frontend.id
  key        = each.value
  value      = local.vercel_env_values[each.value]
  target     = ["production", "preview"]
  sensitive  = true
}
