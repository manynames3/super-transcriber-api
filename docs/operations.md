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

`successUrl` and `cancelUrl` may be omitted. The configured `billing_success_url` defaults to the Cloudflare Pages receipt page, which claims the key after payment. The cancel URL falls back to API health. A custom domain is not required. Claim the API key after successful checkout with the `checkoutSessionId` and `claimToken` from the checkout response or success redirect:

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

## Run SQS Workers In Development

The queue consumers are Lambda SQS event-source mappings, not polling loops in the application. Lambda performs `ReceiveMessage` calls and invokes the handlers only when a batch exists, so application code cannot observe an empty receive or apply its own idle backoff. Terraform sets every queue's receive wait time to 20 seconds and disables the mappings by default for `dev`, `development`, and `local`, eliminating idle dev polling. Production and other environments remain enabled by default.

Enable all SQS workers intentionally while exercising an async development flow:

```bash
export TF_VAR_enable_sqs_workers=true
terraform -chdir=terraform apply
terraform -chdir=terraform output -raw sqs_workers_enabled
```

Disable the mappings again when finished:

```bash
export TF_VAR_enable_sqs_workers=false
terraform -chdir=terraform apply
```

Messages sent while workers are disabled remain queued until a mapping is enabled or the four-day source-queue retention period expires. Worker failures are recorded as structured CloudWatch entries; empty receives do not invoke application handlers. The handlers return partial batch failures, so Lambda deletes only successfully processed messages.

To verify request usage, graph `AWS/SQS` -> `NumberOfEmptyReceives`, filter by `QueueName`, select `Sum`, and use a one-day period. The equivalent CLI query for June is:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name NumberOfEmptyReceives \
  --dimensions Name=QueueName,Value=super-transcriber-api-dev-transcription-start \
  --start-time 2026-06-01T00:00:00Z \
  --end-time 2026-07-01T00:00:00Z \
  --period 86400 \
  --statistics Sum \
  --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Sum]' \
  --output table
```

After the dev mappings are disabled, daily `NumberOfEmptyReceives` should fall to zero for these queues unless another consumer outside this Terraform stack is polling them.

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

## Durable Completion And Reconciliation

Job admission and terminal settlement use DynamoDB transactions. Pending events are stored in an outbox and dispatched by a filtered DynamoDB stream. A queue-send failure leaves the event pending. Duplicate delivery is expected; callbacks carry a stable event ID.

An hourly `reconcile-jobs` Lambda retries pending outbox events and checks stale jobs against Transcribe. Recovery queries are bounded to 100 records per category per run. Jobs past a 24-hour processing deadline are failed and their usage is settled. Completion and recovery Lambda execution failures go to the completion SQS DLQ; EventBridge target delivery failures use the same queue.

Inspect logs without dumping request bodies, API keys, receipts, or media:

```bash
aws logs tail /aws/lambda/super-transcriber-api-dev-start-transcription --since 1h --region us-east-1
aws logs tail /aws/lambda/super-transcriber-api-dev-dispatch-outbox --since 1h --region us-east-1
aws logs tail /aws/lambda/super-transcriber-api-dev-reconcile-jobs --since 1h --region us-east-1
```

Use `GET /v1/webhooks/deliveries` to inspect customer-visible attempts and the replay endpoint to retry them. Replay completion events through the completion Lambda only after checking their Transcribe job name; the handler reads the authoritative service status and settlement is idempotent.

## Key Recovery And Deletion

Customers can create, list, revoke, and rotate scoped keys. Revocation is immediate after the key record is updated. Rotating the currently connected account key requires replacing the client credential. Checkout receipts permit recovery for 24 hours; after that, verify customer ownership through your support process before admin provisioning. Never request that customers post keys in GitHub issues.

Soft deletion hides a job. The `/data` deletion endpoint permanently purges eligible jobs, including already soft-deleted jobs. Wait for active processing and upload URL expiry. Standard S3 lifecycle and DynamoDB TTL cleanup remain asynchronous; job metadata/mappings are assigned the transcript-retention TTL. Logs retain 14 days, dispatched outbox records 7 days, and delivery records 30 days.

## State And Release Safety

Use encrypted S3 state with `use_lockfile=true` and a separate key for each environment. Protect the state bucket with IAM and versioning in the bootstrap account. Terraform 1.10+ and the locked AWS provider are required. Runtime, bundle target, and CI use Node.js 24.

When adopting this already-deployed API after local state loss, `scripts/adopt-existing-stack.mjs` discovers only resources matching the selected API/stack prefix and generates ignored import blocks and configuration. Review the plan with `scripts/check-plan.mjs`; it rejects deletions/replacements. Never import the original consumer application's state into this API stack.

```bash
API_ID=your-api-id STACK_PREFIX=super-transcriber-api-dev node scripts/adopt-existing-stack.mjs
terraform -chdir=terraform init -backend-config=backend.hcl
terraform -chdir=terraform plan -out=tfplan
terraform -chdir=terraform show -json tfplan | node scripts/check-plan.mjs
terraform -chdir=terraform apply tfplan
```

Remove generated import blocks after successful adoption. The hosted release enables SQS workers; disabling them pauses processing. The account and receipt pages are static Pages assets, with API keys kept in browser memory. Receipts may stay in session storage for recovery, so treat the receipt token as a secret.

## Security Scan Policy

CI Checkov failures block the release outside explicit exceptions in `.checkov.yml`. Those exceptions cover Lambda-side auth, no VPC, AWS-managed encryption, 14-day logs, unversioned regional media, optional PITR/tracing, and operator-managed secret rotation. They are architectural decisions, not a claim that every default Checkov recommendation is implemented.

## Cost Guardrails

Keep AI enrichment, paid alarms, and PITR disabled unless needed. Set per-key request limits, customer concurrency/minute limits, S3/log retention, API stage throttles, and Lambda concurrency caps. Monitor queue age and failure depth after changes. Idle budget is a target below $3/month, while active transcription/storage/request charges vary with usage; verify account billing rather than treating a health response as cost evidence.
