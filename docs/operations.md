# Operations

## Create an API Key

Set the deployed API base URL and admin token. Terraform stores `admin_token` in Secrets Manager unless you provide `admin_token_secret_arn`.

```bash
export API_BASE_URL="$(terraform -chdir=terraform output -raw api_endpoint)"
export ADMIN_TOKEN="replace-with-the-admin-token-from-your-tfvars"
```

Create a key:

```bash
curl -sS -X POST "$API_BASE_URL/v1/api-keys" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"customerName":"Acme Dev","keyName":"Local dev key"}'
```

Store the returned plaintext key outside Terraform. The database stores only the SHA-256 hash.

## Enable Monetized Self-Serve Checkout

Create two AWS Secrets Manager secrets outside Terraform or with your preferred secret process:

```bash
aws secretsmanager create-secret \
  --name super-transcriber-api/dev/stripe-secret-key \
  --secret-string '{"secretKey":"sk_test_..."}'

aws secretsmanager create-secret \
  --name super-transcriber-api/dev/stripe-webhook-secret \
  --secret-string '{"webhookSecret":"whsec_..."}'
```

Set Terraform variables:

```hcl
stripe_secret_arn         = "arn:aws:secretsmanager:us-east-1:123456789012:secret:super-transcriber-api/dev/stripe-secret-key"
stripe_webhook_secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:super-transcriber-api/dev/stripe-webhook-secret"

stripe_price_ids = {
  starter = "price_..."
  team    = "price_..."
}
```

Configure the Stripe webhook endpoint with the API Gateway URL:

```text
https://{api-id}.execute-api.{region}.amazonaws.com/v1/billing/webhook
```

Required Stripe events:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Create checkout:

```bash
curl -sS -X POST "$API_BASE_URL/v1/billing/checkout" \
  -H "content-type: application/json" \
  -d '{"email":"dev@example.com","planId":"starter"}'
```

`successUrl` and `cancelUrl` may be omitted while you do not have a stable domain; the API Gateway URL is used as the fallback Stripe redirect target. Claim the API key after successful checkout with the `checkoutSessionId` and `claimToken` from the checkout response or success redirect:

```bash
curl -sS -X POST "$API_BASE_URL/v1/billing/claim" \
  -H "content-type: application/json" \
  -d '{"checkoutSessionId":"cs_test_...","claimToken":"claim_token_from_redirect"}'
```

Create a billing portal session:

```bash
curl -sS -X POST "$API_BASE_URL/v1/billing/portal" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"returnUrl":"https://example.com/account"}'
```

## Submit a Job

Presign the upload:

```bash
curl -sS -X POST "$API_BASE_URL/v1/uploads/presign" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"fileName":"meeting.mp3","contentType":"audio/mpeg","fileSizeBytes":1048576}'
```

Upload the audio:

```bash
curl -X PUT "$UPLOAD_URL" \
  -H "content-type: audio/mpeg" \
  --upload-file ./meeting.mp3
```

Queue transcription:

```bash
curl -sS -X POST "$API_BASE_URL/v1/transcriptions" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d "{\"s3Key\":\"$S3_KEY\",\"durationSeconds\":600,\"speakerCount\":2}"
```

The `jobId` returned by the presign step is embedded in the `s3Key` and becomes the transcription job id, so clients can persist one id before upload and use it for polling.

Poll status:

```bash
curl -sS "$API_BASE_URL/v1/transcriptions/$JOB_ID" -H "x-api-key: $API_KEY"
```

Expected lifecycle:

```text
PENDING_UPLOAD -> QUEUED -> STARTING -> IN_PROGRESS -> COMPLETED
PENDING_UPLOAD -> QUEUED -> STARTING -> FAILED
```

## Configure Webhooks

```bash
curl -sS -X POST "$API_BASE_URL/v1/webhooks" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/webhooks/super-transcriber","events":["transcription.completed","transcription.failed"],"enabled":true}'
```

Webhook deliveries are SQS-backed and retried. Verify the `x-super-transcriber-signature` header by computing `HMAC-SHA256` over `{timestamp}.{payload}` with the returned signing secret.

## Enable Optional AI Enrichment

Set these Terraform variables:

```hcl
enable_ai_enrichment = true
bedrock_model_id     = "anthropic.claude-3-haiku-20240307-v1:0"
```

When enabled, the completion handler enqueues an enrichment job after successful transcription. The enrichment Lambda reads the transcript JSON, calls Amazon Bedrock, writes enrichment JSON to the transcript bucket, and `GET /v1/transcriptions/{jobId}` returns `enrichmentJsonUrl` after the enrichment record exists.

## Inspect Lambda Logs

Tail one handler:

```bash
aws logs tail "/aws/lambda/super-transcriber-api-dev-create-transcription" \
  --follow \
  --format short
```

Search structured fields:

```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/super-transcriber-api-dev-completion" \
  --filter-pattern '{ $.jobId = "8d1c67c8-89d7-4b2f-9b0e-b15ea5f41c81" }'
```

Safe log fields include `requestId`, `customerId`, `route`, `jobId`, and `transcribeJobName`. Raw API keys are not logged.

## Replay Completion Events

If EventBridge invokes the completion Lambda and the invocation fails, the event is sent to the SQS DLQ. Inspect the message:

```bash
DLQ_URL="$(terraform -chdir=terraform output -raw completion_dlq_url)"

aws sqs receive-message \
  --queue-url "$DLQ_URL" \
  --max-number-of-messages 1 \
  --attribute-names All \
  --message-attribute-names All
```

Save the event body to `completion-event.json`, then replay by invoking the completion Lambda:

```bash
aws lambda invoke \
  --function-name super-transcriber-api-dev-completion \
  --payload fileb://completion-event.json \
  replay-output.json
```

After a successful replay, delete the DLQ message with its receipt handle:

```bash
aws sqs delete-message \
  --queue-url "$DLQ_URL" \
  --receipt-handle "$RECEIPT_HANDLE"
```

## Check DLQ Depth

```bash
aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages
```

If `enable_cloudwatch_alarms=true`, Terraform also creates an alarm for visible DLQ messages.

Additional queue DLQs:

```bash
terraform -chdir=terraform output -raw transcription_start_dlq_url
terraform -chdir=terraform output -raw webhook_delivery_dlq_url
terraform -chdir=terraform output -raw enrichment_dlq_url
```

## Common Failures

`Invalid API key`: confirm the request uses `x-api-key` or `Authorization: Bearer`, the key has the `stapi_` format, and the key was created by `POST /v1/api-keys`.

`Quota exceeded`: active jobs reached the configured limit, or reserved monthly transcription seconds would exceed the monthly minute limit. Omitted `durationSeconds` reserves the full max duration.

`S3 URI not accessible`: the `s3Key` must start with `customers/{customerId}/uploads/`, the object must exist in the uploads bucket, and the upload must have completed before starting the job.

`Job stuck in QUEUED or STARTING`: inspect the `start-transcription` Lambda logs and the `transcription_start_dlq_url` queue.

`Transcribe not enabled`: confirm Amazon Transcribe is available in the selected region and the account is allowed to use it.

`Transcribe output missing`: inspect the Transcribe job in AWS, confirm the transcript bucket policy allows the Transcribe service principal to write output, and check the completion Lambda logs.

`Webhook not delivered`: inspect the `deliver-webhook` Lambda logs and `webhook_delivery_dlq_url`.

`AI enrichment missing`: confirm `enable_ai_enrichment=true`, Bedrock model access is enabled in the AWS account, and `enrichment_dlq_url` is empty.

## Cost Guardrails

- Keep `max_active_jobs`, `max_duration_seconds`, and `monthly_transcription_minutes` conservative for dev accounts.
- Keep lifecycle retention short for uploads and transcripts.
- Leave `enable_cloudwatch_alarms=false` unless alarm costs are acceptable.
- Keep monetization secrets limited to the Stripe secret key, Stripe webhook secret, and optional admin token secret. Those are the main predictable idle costs in the paid-product path and should stay comfortably below $3/month before traffic.
- Use API Gateway stage throttling for coarse request control.
- Keep optional Bedrock enrichment disabled unless the deployment needs LLM outputs.
- HTTP API does not use REST API usage plans in this stack. Per-key limits are enforced by Lambda and DynamoDB usage counters.
- Avoid enabling VPC attachment, NAT Gateway, provisioned capacity, or fixed monthly services.
