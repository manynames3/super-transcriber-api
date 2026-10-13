# Super Transcriber API

Super Transcriber API turns the original Super Transcriber audio-upload web app into a developer-facing REST API. Built with TypeScript, Terraform, and AWS serverless services, it supports private MP3/M4A uploads, durable asynchronous transcription, speaker-aware TXT/JSON/SRT/VTT downloads, customer API keys, measured usage, signed webhooks, and optional Stripe subscriptions. Teams can use the hosted API or deploy the same stack into their own AWS account.

## Live Links

- [Product site](https://super-transcriber-api.pages.dev/) · [Developer account](https://super-transcriber-api.pages.dev/account)
- [API health](https://pn72sppog0.execute-api.us-east-1.amazonaws.com/health) · [API reference](https://super-transcriber-api.pages.dev/api-reference)
- [OpenAPI contract](openapi/openapi.yaml) · [TypeScript SDK](sdk/typescript) · [Architecture](docs/architecture.md)

![Super Transcriber API platform preview](landing/assets/api-console-preview-dark.svg)

## About

The original Super Transcriber is an end-user-facing transcription web app. This edition packages its core workflow for developers and companies adding transcription to existing products, CRMs, internal tools, media workflows, or AI applications. Customers integrate over HTTP without managing AWS themselves; private deployments keep media, transcripts, and processing infrastructure in a customer-owned AWS account. This repository describes an implemented project and validation evidence, not production traffic or customer adoption.

## Tech Stack

| Area | Technology |
| --- | --- |
| Runtime | TypeScript, Lambda Node.js 24, arm64 |
| API | API Gateway HTTP API, OpenAPI 3.1, typed SDK |
| Processing | SQS, Amazon Transcribe, EventBridge, DynamoDB Streams |
| Storage | DynamoDB on-demand single table; private, lifecycle-managed S3 |
| Billing | Optional Stripe Checkout, subscriptions, and Billing Portal |
| Optional transcript enrichment | Transcript enrichment worker calling an LLM through Amazon Bedrock; disabled by default |
| Infrastructure | Terraform with encrypted S3 state and native state locking |
| Website | Static Cloudflare Pages product site and developer account |
| Verification | Vitest, SDK tests, Terraform tests, Checkov, CodeQL, dependency audits |

## Engineering Highlights

Amazon Transcribe provides speech recognition and speaker diarization. The transcript enrichment worker is ordinary TypeScript Lambda code that can call an LLM through Amazon Bedrock after transcription; it is not an autonomous agent or an always-running model. Enrichment is disabled on the hosted deployment, so normal transcription does not make LLM calls.

- Transactional job admission reserves customer concurrency and writes a durable start event together.
- Workers seal uploaded media into a processing-only S3 path and measure duration before starting Transcribe.
- Completion atomically settles usage, releases concurrency, and records callback/enrichment events. Stream dispatch and hourly reconciliation recover interrupted work.
- Stable webhook event IDs, signed payloads, delivery history, retries, and customer-controlled replay support reliable integrations.
- API keys are hashed, scoped, revocable, and rotated transactionally. Ownership checks and per-key rate counters isolate customers.
- Plan changes apply to existing keys; measured usage and failed-job refunds keep limits independent of caller duration hints.
- Terraform assigns a separate IAM role to every Lambda and retains logs for 14 days.

## Available API Endpoints

Base URL: `https://pn72sppog0.execute-api.us-east-1.amazonaws.com`. Protected routes accept `x-api-key` or a bearer API key.

| Endpoint | Purpose | Returns |
| --- | --- | --- |
| `GET /`, `GET /health` | Public availability and capabilities | Version, OK status, optional billing availability |
| `POST /v1/uploads/presign` | Reserve an MP3/M4A upload | Private PUT URL, headers, job ID, S3 key |
| `POST /v1/transcriptions` | Submit an owned upload | Job ID, status, polling URL |
| `GET /v1/transcriptions/{jobId}` | Poll or retrieve transcript | Status, measured duration, text, raw JSON URL |
| `GET /v1/transcriptions/{jobId}/transcript?format=txt` | Download output | TXT, normalized JSON, SRT, or VTT attachment |
| `GET /v1/transcriptions` | List recent jobs | Job summaries and cursor |
| `DELETE /v1/transcriptions/{jobId}` | Hide a job | Soft deletion; 204 |
| `DELETE /v1/transcriptions/{jobId}/data` | Permanently purge eligible job data | Audio, outputs, and metadata deletion; 204 |
| `POST /v1/api-keys` | Create a scoped key; admin can provision accounts | Plaintext key once |
| `GET /v1/api-keys` | List owned key metadata | Prefix, scopes, status, cursor |
| `DELETE /v1/api-keys/{keyId}` | Revoke a key | Disabled-key confirmation |
| `POST /v1/api-keys/{keyId}/rotate` | Replace and revoke atomically | Replacement plaintext key once |
| `POST /v1/webhooks` | Configure a public HTTPS callback | Configuration and initial signing secret |
| `GET /v1/webhooks/deliveries` | Inspect callback attempts | Delivery status, attempts, cursor |
| `POST /v1/webhooks/deliveries/{eventId}/replay` | Replay an owned callback | Queued confirmation |
| `POST /v1/billing/checkout` | Public optional Stripe signup | Checkout URL and secret claim receipt |
| `POST /v1/billing/claim` | Claim/recover paid API access | Customer and one-time API key |
| `GET /v1/billing/account` | Read plan and usage | Limits, active jobs, used/reserved/remaining minutes |
| `POST /v1/billing/portal` | Open optional subscription management | Stripe portal URL |
| `POST /v1/billing/webhook` | Receive signed Stripe events | Acknowledgment |

Detailed permissions, examples, and errors: [API reference](docs/api-reference.md).

## API Quickstart

The integration is `presign -> S3 PUT -> start job -> webhook or poll -> download text`.

Install the SDK release package:

```bash
npm install https://github.com/manynames3/super-transcriber-api/releases/download/v1.0.1/super-transcriber-api-client-1.0.1.tgz
```

```ts
import { readFile } from "node:fs/promises";
import { SuperTranscriberClient } from "@super-transcriber/api-client";

const client = new SuperTranscriberClient({
  baseUrl: "https://pn72sppog0.execute-api.us-east-1.amazonaws.com",
  apiKey: process.env.SUPER_TRANSCRIBER_API_KEY!
});
const audio = new Blob([await readFile("meeting.mp3")], { type: "audio/mpeg" });
const job = await client.transcribeFile(audio, { fileName: "meeting.mp3", speakerCount: 2 });
console.log(job.transcriptText);
const text = await client.downloadTranscript(job.jobId, "txt");
```

For background integrations, `transcribeUpload()` returns the accepted job immediately. The SDK also provides polling timeouts, cancellation, typed errors, safe retries, and webhook signature verification. [SDK documentation](sdk/typescript/README.md).

The equivalent curl flow uses jq to carry the returned upload details:

```bash
export API_BASE_URL="https://pn72sppog0.execute-api.us-east-1.amazonaws.com"
export API_KEY="YOUR_API_KEY"

PRESIGN=$(curl --fail-with-body -sS "$API_BASE_URL/v1/uploads/presign" \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d "$(jq -n --argjson size "$(wc -c < meeting.mp3)" \
    '{fileName:"meeting.mp3",contentType:"audio/mpeg",fileSizeBytes:$size}')")
UPLOAD_URL=$(printf '%s' "$PRESIGN" | jq -r .uploadUrl)
S3_KEY=$(printf '%s' "$PRESIGN" | jq -r .s3Key)
JOB_ID=$(printf '%s' "$PRESIGN" | jq -r .jobId)

curl --fail-with-body -X PUT "$UPLOAD_URL" -H "content-type: audio/mpeg" --upload-file meeting.mp3
curl --fail-with-body -sS "$API_BASE_URL/v1/transcriptions" \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -d "$(jq -n --arg key "$S3_KEY" '{s3Key:$key,speakerCount:2}')"
curl -sS "$API_BASE_URL/v1/transcriptions/$JOB_ID?includeTranscript=false" -H "x-api-key: $API_KEY"
# After COMPLETED:
curl --fail-with-body -sS "$API_BASE_URL/v1/transcriptions/$JOB_ID/transcript?format=txt" \
  -H "x-api-key: $API_KEY" -o meeting.txt
```

## Architecture

API Gateway routes requests to small Lambda handlers. Audio uploads go directly to private S3. DynamoDB transactions and an outbox decouple API acceptance from SQS delivery. A worker validates sealed media, reserves verified minutes, and starts Amazon Transcribe. EventBridge completion and hourly reconciliation settle usage and create durable webhook/enrichment events.

[Architecture and C4-style diagram](docs/architecture.md) · [Architecture decisions](docs/adrs) · [Operations](docs/operations.md)

## Deployment Model

Terraform manages the AWS backend. The static website is deployed separately to Cloudflare Pages. Private deployments use the same code and infrastructure with customer-selected AWS configuration.

```bash
cd lambda
npm ci
npm run build
npm test
npm run bundle
cd ../terraform
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform show -json tfplan | node ../scripts/check-plan.mjs
terraform apply tfplan
```

Prepare `backend.hcl` from the example using an existing encrypted state bucket. Native S3 locking avoids a separate lock table. Use `admin_token_secret_arn` for an existing admin secret; keep secrets and state out of Git.

Dev/local SQS mappings default to disabled. Set `enable_sqs_workers=true` for a working hosted API; other environments enable them by default. [Deployment and recovery details](docs/operations.md).

## Cost Controls

- No VPC, NAT Gateway, RDS, provisioned concurrency, always-on servers, or provisioned DynamoDB capacity.
- Idle design target: below $3/month with minimal retained storage, one admin secret, and optional paid features disabled. This is a budget target, not a measured billing guarantee.
- SQS long polling, filtered stream processing, and bounded hourly reconciliation keep background work small.
- The transcript enrichment worker's SQS trigger stays disabled unless both `enable_sqs_workers` and `enable_ai_enrichment` are enabled. Turning enrichment off stops its polling without pausing transcription or webhook delivery.
- S3 retains audio for 7 days and transcript/enrichment objects for 30 days by default. Logs retain 14 days.
- Default limits: 5 active jobs, 200 MB files, 20-minute audio, 120 monthly minutes. Active-job limits span calendar months.
- Usage is measured in whole seconds, reserved before Transcribe, then consumed on success or refunded on failure. Calendar-month counters and rate counters enforce customer limits.
- Stripe, Bedrock enrichment, alarms, and DynamoDB PITR remain configurable. Transcription and other active workload charges are additional.

## Security And Privacy Model

Keys are returned once and stored as SHA-256 hashes. Base-table reads enforce revocation immediately after key lookup. Scoped permissions, per-key rate limits, private encrypted S3, HTTPS-only bucket policies, and customer ownership checks protect access. Webhook delivery validates and pins public DNS addresses, rejects redirects, and signs each attempt.

Soft deletion hides jobs. Permanent purge removes audio, transcripts, enrichment, job records, and Transcribe metadata after processing finishes and the upload URL expires. Aggregate usage and short-lived operational/rate records remain. Browser account access keeps API keys in memory; application integrations should keep their keys on the backend.

## Local Validation

```bash
cd lambda && npm ci && npm run build && npm test && npm run bundle && npm audit
cd ../sdk/typescript && npm ci && npm test
cd ../.. && node scripts/check-contract.mjs
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform fmt -check -recursive
terraform -chdir=terraform validate
terraform -chdir=terraform test
checkov -d terraform --config-file .checkov.yml
git diff --check
```

[Validation evidence](docs/validation-evidence.md) records executed checks. [Benchmarking](docs/benchmarking.md) explains how to measure accuracy and latency on your own audio.

## CI And Deployment Status

Push/PR CI checks TypeScript, backend and SDK tests, dependencies, bundles, OpenAPI route consistency, Terraform, Checkov, CodeQL, and whitespace. Checkov blocks findings outside the documented cost/privacy exceptions in [.checkov.yml](.checkov.yml). AWS deployment is manual; an optional OIDC workflow is in [.github/examples](.github/examples). The public SDK is distributed as a GitHub release tarball; npm registry publication requires maintainer credentials.

## Project Structure

```text
docs/             Architecture, API, operations, validation, benchmarking, ADRs
landing/          Static product site, developer account, checkout receipt
lambda/           TypeScript handlers, shared processing logic, Vitest tests
openapi/          OpenAPI 3.1 contract
sdk/typescript/   Typed client, tests, release package
terraform/        AWS resources, native S3 backend, infrastructure tests
scripts/          Contract checks, plan guard, state adoption, benchmarking
.github/          CI and optional manual AWS deployment example
```

## Implemented And Limitations

Implemented: upload/start/poll/download, diarization, normalized speaker/timing output, quotas, durable events and recovery, key management, webhook history/replay, permanent purge, optional billing and enrichment, SDK, and developer account.

`sourceUrl` ingestion returns `501 NOT_IMPLEMENTED`. Stripe and Bedrock require configuration and are disabled on the default deployment. There is no real-time streaming transcription or advertised SLA. MP3/M4A are the supported input formats. Accuracy and latency depend on audio and service behavior; no production-scale or customer-adoption claims are made.

©2026 SUPREME AI VENTURES LLC
