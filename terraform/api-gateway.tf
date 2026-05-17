locals {
  http_routes = {
    "GET /health" = {
      lambda_key = "health"
    }
    "POST /v1/api-keys" = {
      lambda_key = "create-api-key"
    }
    "POST /v1/webhooks" = {
      lambda_key = "configure-webhook"
    }
    "POST /v1/uploads/presign" = {
      lambda_key = "presign-upload"
    }
    "POST /v1/transcriptions" = {
      lambda_key = "create-transcription"
    }
    "GET /v1/transcriptions" = {
      lambda_key = "list-transcriptions"
    }
    "GET /v1/transcriptions/{jobId}" = {
      lambda_key = "get-transcription"
    }
    "DELETE /v1/transcriptions/{jobId}" = {
      lambda_key = "delete-transcription"
    }
  }
}

resource "aws_apigatewayv2_api" "http" {
  name          = local.name_prefix
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = var.cors_allowed_headers
    allow_methods = var.cors_allowed_methods
    allow_origins = var.cors_allowed_origins
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  for_each = local.http_routes

  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.handlers[each.value.lambda_key].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "lambda" {
  for_each = local.http_routes

  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.lambda[each.key].id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.api_throttle_burst_limit
    throttling_rate_limit  = var.api_throttle_rate_limit
  }
}

resource "aws_lambda_permission" "api_gateway" {
  for_each = toset(distinct([for route in local.http_routes : route.lambda_key]))

  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handlers[each.value].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
