# Operations

## Create an API Key

Set the deployed API base URL and admin token:

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

Start transcription:

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

## Common Failures

`Invalid API key`: confirm the request uses `x-api-key` or `Authorization: Bearer`, the key has the `stapi_` format, and the key was created by `POST /v1/api-keys`.

`Quota exceeded`: active jobs reached the configured limit, or reserved monthly transcription seconds would exceed the monthly minute limit. Omitted `durationSeconds` reserves the full max duration.

`S3 URI not accessible`: the `s3Key` must start with `customers/{customerId}/uploads/`, the object must exist in the uploads bucket, and the upload must have completed before starting the job.

`Transcribe not enabled`: confirm Amazon Transcribe is available in the selected region and the account is allowed to use it.

`Transcribe output missing`: inspect the Transcribe job in AWS, confirm the transcript bucket policy allows the Transcribe service principal to write output, and check the completion Lambda logs.

## Cost Guardrails

- Keep `max_active_jobs`, `max_duration_seconds`, and `monthly_transcription_minutes` conservative for dev accounts.
- Keep lifecycle retention short for uploads and transcripts.
- Leave `enable_cloudwatch_alarms=false` unless alarm costs are acceptable.
- Use API Gateway stage throttling for coarse request control.
- HTTP API does not use REST API usage plans in this stack. Per-key limits are enforced by Lambda and DynamoDB usage counters.
- Avoid enabling VPC attachment, NAT Gateway, provisioned capacity, or fixed monthly services.
