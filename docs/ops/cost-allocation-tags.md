# Cost Allocation Tags

All AWS resources managed in `infra/terraform` carry the following cost allocation tags,
applied automatically through the AWS provider's `default_tags` block.

| Tag key       | Terraform variable | Default                | Purpose                                  |
| ------------- | ------------------ | ---------------------- | ---------------------------------------- |
| `project`     | `project`          | `lumigift`             | Groups all spend for the product         |
| `environment` | `env`              | `prod`                 | Separates `prod` / `staging` spend       |
| `owner`       | `owner`            | `platform`             | Team accountable for the resource        |
| `cost-center` | `cost_center`      | `lumigift-engineering` | Finance cost center billed for the spend |

`ManagedBy = terraform` is also applied but is not a cost allocation tag.

## Conventions

- Tag keys are lowercase and kebab-case; values are lowercase.
- Do not set these keys per-resource — rely on `default_tags`. Resource-level `tags`
  may add extra keys but must not override the four above.
- Override values per environment via `terraform.tfvars`, never by editing defaults inline.

## Reporting

The four tag keys are activated as cost allocation tags (`aws_ce_cost_allocation_tag`),
so AWS Cost Explorer can group and filter by `project`, `environment`, `owner` and
`cost-center`. Newly activated tags take up to 24 hours to appear in Cost Explorer.

## Enforcement

An AWS Config `REQUIRED_TAGS` rule (`lumigift-<env>-required-tags`) evaluates every
recorded resource. When a resource becomes `NON_COMPLIANT`, an EventBridge rule
publishes to the `lumigift-<env>-tag-compliance-alerts` SNS topic, which emails
`ops_alert_email`.
