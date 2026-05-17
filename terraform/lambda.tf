resource "aws_lambda_function" "handlers" {
  for_each = local.lambda_functions

  function_name                  = "${local.name_prefix}-${each.key}"
  role                           = aws_iam_role.lambda.arn
  handler                        = "index.handler"
  runtime                        = "nodejs20.x"
  architectures                  = ["arm64"]
  filename                       = each.value.filename
  source_code_hash               = filebase64sha256(each.value.filename)
  memory_size                    = each.value.memory_size
  timeout                        = each.value.timeout
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  environment {
    variables = local.lambda_environment
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda
  ]
}
