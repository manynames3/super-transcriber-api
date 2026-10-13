locals {
  http_routes = {
    "GET /v1/transcriptions/{jobId}/transcript"     = { lambda_key = "download-transcript" }
    "DELETE /v1/transcriptions/{jobId}/data"        = { lambda_key = "purge-transcription" }
    "GET /v1/api-keys"                              = { lambda_key = "manage-api-keys" }
    "DELETE /v1/api-keys/{keyId}"                   = { lambda_key = "manage-api-keys" }
    "POST /v1/api-keys/{keyId}/rotate"              = { lambda_key = "manage-api-keys" }
    "GET /v1/webhooks/deliveries"                   = { lambda_key = "webhook-deliveries" }
    "POST /v1/webhooks/deliveries/{eventId}/replay" = { lambda_key = "webhook-deliveries" }
    "GET /" = {
      lambda_key = "health"
    }
    "GET /health" = {
      lambda_key = "health"
    }
    "POST /v1/api-keys" = {
      lambda_key = "create-api-key"
    }
    "POST /v1/billing/checkout" = {
      lambda_key = "create-checkout-session"
    }
    "POST /v1/billing/webhook" = {
      lambda_key = "stripe-webhook"
    }
    "POST /v1/billing/claim" = {
      lambda_key = "claim-checkout-session"
    }
    "GET /v1/billing/account" = {
      lambda_key = "get-billing-account"
    }
    "POST /v1/billing/portal" = {
      lambda_key = "create-billing-portal"
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

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format          = jsonencode({ requestId = "$context.requestId", route = "$context.routeKey", status = "$context.status", responseLength = "$context.responseLength" })
  }

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
