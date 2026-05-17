# Super Transcriber API

Super Transcriber API is a developer-facing, privacy-conscious transcription backend for teams that want a clean REST API on a cost-first AWS serverless stack. It accepts private S3 uploads, queues durable asynchronous Amazon Transcribe jobs, records status and usage in DynamoDB, and can be deployed as a hosted API or into a customer-owned AWS account with the same Terraform.

## Product Lineage

This API-first version was developed from the original Super Transcriber, an end-user-facing transcription web app. The goal of this repository is to package the core transcription workflow as a ready-to-integrate backend for developers, teams, and organizations that want to embed transcription into an existing product, internal system, or AWS-native tech stack.

## Sales Landing Page

A static developer-facing sales page is included at `landing/index.html`. It can be opened directly or served from any static host, and it adds no AWS idle cost to the API deployment.

## API Quickstart

The easiest integration path is: presign an upload, PUT the audio file to S3, then queue transcription with the returned `s3Key`. The same `jobId` is used for upload tracking, transcription status, polling, transcript retrieval, optional AI enrichment, and webhook delivery.

Deploy the stack, then set:

```bash
export API_BASE_URL="$(terraform -chdir=terraform output -raw api_endpoint)"
export ADMIN_TOKEN="replace-with-your-admin-token"
```

Create an API key. The plaintext key is returned once.

```bash
curl -sS -X POST "$API_BASE_URL/v1/api-keys" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"customerName":"Acme Dev","keyName":"Local dev key"}'
```

Presign an upload.

```bash
export API_KEY="stapi_example_key"

curl -sS -X POST "$API_BASE_URL/v1/uploads/presign" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"fileName":"meeting.mp3","contentType":"audio/mpeg","fileSizeBytes":1048576}'
```

Upload the file with the returned `uploadUrl`.

```bash
curl -X PUT "$UPLOAD_URL" \
  -H "content-type: audio/mpeg" \
  --upload-file ./meeting.mp3
```

Start transcription with the returned `s3Key`.

```bash
curl -sS -X POST "$API_BASE_URL/v1/transcriptions" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"s3Key":"customers/cust_123/uploads/2d1d7a53-9f34-40d3-9d2a-839bfb29d821/meeting.mp3","durationSeconds":600,"speakerCount":2}'
```

Poll and list jobs.

```bash
curl -sS "$API_BASE_URL/v1/transcriptions/$JOB_ID" -H "x-api-key: $API_KEY"
curl -sS "$API_BASE_URL/v1/transcriptions?limit=20" -H "x-api-key: $API_KEY"
```

Opening `$API_BASE_URL` directly returns the public API status payload. `GET /health` returns the same health response for uptime checks.

The `jobId` returned from the presign step is the same `jobId` used for transcription status, so clients can create one durable id before the audio upload starts.

Configure a completion webhook.

```bash
curl -sS -X POST "$API_BASE_URL/v1/webhooks" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/webhooks/super-transcriber","events":["transcription.completed","transcription.failed"]}'
```

Use the TypeScript SDK.

```ts
import { SuperTranscriberClient } from "@super-transcriber/api-client";

const client = new SuperTranscriberClient({
  baseUrl: process.env.API_BASE_URL!,
  apiKey: process.env.SUPER_TRANSCRIBER_API_KEY!
});

const presign = await client.presignUpload({
  fileName: "meeting.mp3",
  contentType: "audio/mpeg",
  fileSizeBytes: 1048576
});
```

Create a paid self-serve checkout session without needing a custom domain.

```bash
curl -sS -X POST "$API_BASE_URL/v1/billing/checkout" \
  -H "content-type: application/json" \
  -d '{"email":"dev@example.com","planId":"starter"}'
```

`successUrl` and `cancelUrl` are optional. If you omit them, the API uses the deployed API Gateway URL as the Stripe redirect target, so the paid flow works before you have a custom domain. After Stripe redirects back, or by using the `checkoutSessionId` and `claimToken` returned by the checkout response, claim the API key once.

```bash
curl -sS -X POST "$API_BASE_URL/v1/billing/claim" \
  -H "content-type: application/json" \
  -d '{"checkoutSessionId":"cs_test_...","claimToken":"claim_token_from_success_redirect"}'
```

## Architecture Summary

Requests enter through API Gateway HTTP API and are routed to small Node.js 20 Lambda handlers on arm64. DynamoDB uses a single-table PAY_PER_REQUEST model for customers, hashed API keys, jobs, Transcribe mappings, webhook config, optional enrichment metadata, and monthly usage counters. S3 stores uploaded audio, transcript JSON, and optional enrichment JSON in private buckets with lifecycle expiration. SQS decouples job submission from Transcribe start, webhook delivery, and optional AI enrichment. Amazon Transcribe runs asynchronous jobs, and EventBridge invokes a completion Lambda when jobs finish or fail.

## AWS Services Used

- API Gateway HTTP API
- AWS Lambda, Node.js 20, arm64
- DynamoDB on-demand capacity
- S3 private buckets
- Amazon Transcribe asynchronous jobs
- EventBridge job-state rule
- SQS queues and dead-letter queues for durable Transcribe start, webhook delivery, AI enrichment, and completion handling
- CloudWatch Logs with Terraform-managed 14-day retention
- Optional CloudWatch alarms, disabled by default
- Optional Amazon Bedrock transcript enrichment, disabled by default
- Optional Stripe Checkout and Billing Portal, disabled unless Stripe secrets and price ids are configured

## Cost Controls

- No VPC, NAT Gateway, RDS, OpenSearch, queues with idle workers, or fixed monthly compute.
- DynamoDB uses PAY_PER_REQUEST.
- S3 lifecycle rules expire uploads and transcripts.
- Lambda and API Gateway are request driven.
- SQS-triggered workers run only while jobs are queued.
- Stripe and Bedrock paths are request/event driven; they do not add meaningful idle compute cost.
- A monetized idle deployment is designed to stay under $3/month before traffic: the main predictable cost is Secrets Manager, typically two Stripe secrets plus one optional admin secret.
- Default limits are 5 active jobs, 200 MB files, 20 minute audio duration, and 120 monthly transcription minutes.
- Duration is reserved before starting Transcribe. If `durationSeconds` is omitted, the full 20 minute maximum is reserved.

## Security Model

End-user API keys are generated by the admin route, stored only as SHA-256 hashes, and looked up through a key id GSI rather than table scans. The API accepts `x-api-key` or `Authorization: Bearer`. The admin token is read from AWS Secrets Manager when configured through Terraform. S3 objects are private, public access is blocked, and upload access is granted only through presigned PUT URLs. Every job and S3 key is validated against the authenticated customer id. Each Lambda has its own IAM role. Webhook payloads are HMAC-signed. Errors use `{ "success": false, "error": "...", "code": "..." }`, and handlers do not log raw API keys.

## CI and Deployment Status

The active CI workflow installs Lambda and SDK dependencies, runs TypeScript checks, executes Vitest unit tests, audits npm dependencies, bundles Lambda zip files, runs Terraform formatting, initializes Terraform without a backend, validates Terraform, runs a soft-fail Checkov IaC scan, runs GitHub dependency review on PRs, runs CodeQL, and checks whitespace. AWS deployment is not active by default. An optional manual deployment workflow is stored under `.github/examples`.

## Implemented vs Not Implemented

Implemented: Stripe Checkout monetization, one-time paid checkout claiming, Billing Portal session creation, API-key creation, hashed API-key auth, presigned S3 uploads, durable SQS-backed transcription starts, explicit job lifecycle states, DynamoDB job storage, cursor pagination, soft deletion, Transcribe completion handling, transcript retrieval, webhook configuration and delivery, optional Bedrock enrichment, usage counters, Terraform infrastructure, per-Lambda IAM roles, OpenAPI contract, TypeScript SDK, unit tests, and CI.

Not implemented in v1: direct `sourceUrl` ingestion. `sourceUrl` returns `501 NOT_IMPLEMENTED`. Stripe remains optional and disabled unless Stripe secrets and price ids are configured.
