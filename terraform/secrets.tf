resource "aws_secretsmanager_secret" "admin_token" {
  count = var.admin_token != "" && var.admin_token_secret_arn == "" ? 1 : 0

  name_prefix             = "${local.name_prefix}-admin-token-"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "admin_token" {
  count = var.admin_token != "" && var.admin_token_secret_arn == "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.admin_token[0].id
  secret_string = var.admin_token
}

locals {
  admin_token_secret_arn = var.admin_token_secret_arn != "" ? var.admin_token_secret_arn : (var.admin_token != "" ? aws_secretsmanager_secret.admin_token[0].arn : "")
}
