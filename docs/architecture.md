# Architecture

Super Transcriber API is a cost-first, serverless transcription API. The customer-facing control plane is REST over API Gateway HTTP API. The data plane keeps media private by uploading audio directly to S3 with presigned URLs, then processing transcription asynchronously through SQS, Amazon Transcribe, EventBridge, and Lambda. Terraform is the only active infrastructure-as-code path for the AWS backend. Cloudflare Pages hosts only the static sales page and API reference.

## C4-Style Container Diagram

```mermaid
flowchart TB
  Buyer["Developer or company system"]
  Visitor["Evaluator browser"]
  Pages["Cloudflare Pages static site<br/>Landing page and API reference"]

  Visitor -->|Reads product docs| Pages
  Buyer -->|REST JSON + API key| HttpApi["API Gateway HTTP API"]
  Buyer -->|PUT audio with presigned URL| Uploads

  subgraph AWS["AWS account managed by Terraform"]
    HttpApi --> Health["Health Lambda"]
    HttpApi --> Admin["Admin/API-key Lambda"]
    HttpApi --> Billing["Billing Lambdas"]
    HttpApi --> WebhookConfig["Webhook config Lambda"]
    HttpApi --> UploadApi["Presign upload Lambda"]
    HttpApi --> JobApi["Job API Lambdas"]

    UploadApi -->|Create PENDING_UPLOAD job| Table["DynamoDB single table"]
    Admin -->|Store hashed API keys| Table
    Billing -->|Sessions, plan state, limits| Table
    WebhookConfig -->|Webhook URL and signing secret| Table
    JobApi -->|Jobs, usage counters, queries| Table

    UploadApi -->|Presign PUT| Uploads["Private S3 uploads bucket"]
    JobApi -->|HeadObject ownership check| Uploads
    JobApi -->|Queue start request| StartQueue["SQS transcription-start queue"]
    StartQueue --> StartWorker["Start-transcription Lambda"]
    StartWorker -->|StartTranscriptionJob| Transcribe["Amazon Transcribe"]
    Transcribe -->|Read audio| Uploads
    Transcribe -->|Write transcript JSON| Transcripts["Private S3 transcripts bucket"]
    Transcribe -->|Job state event| EventBridge["EventBridge rule"]
    EventBridge --> Completion["Completion Lambda"]
    EventBridge -.Target failures.-> CompletionDlq["SQS completion DLQ"]
    Completion -->|Update status and usage| Table
    Completion -->|Read transcript JSON| Transcripts
    Completion -->|Queue delivery| WebhookQueue["SQS webhook queue"]
    Completion -->|Queue when enabled| EnrichmentQueue["SQS enrichment queue"]
    WebhookQueue --> WebhookWorker["Deliver-webhook Lambda"]
    EnrichmentQueue --> EnrichWorker["Enrich-transcript Lambda"]
    EnrichWorker -->|Optional model call| Bedrock["Amazon Bedrock"]
    EnrichWorker -->|Write enrichment JSON| Transcripts
    JobApi -->|Read transcript and presign JSON URL| Transcripts
    Health --> Logs["CloudWatch Logs"]
    Admin --> Logs
    Billing --> Logs
    UploadApi --> Logs
    JobApi --> Logs
    StartWorker --> Logs
    Completion --> Logs
    WebhookWorker --> Logs
    EnrichWorker --> Logs
  end

  Billing -->|Optional checkout, portal, webhooks| Stripe["Stripe"]
  WebhookWorker -->|Signed callback| Buyer
```

## Runtime Flow

```mermaid
sequenceDiagram
  participant Client
  participant API as API Gateway HTTP API
  participant Upload as presign-upload Lambda
  participant DDB as DynamoDB
  participant S3 as S3 uploads
  participant Jobs as create-transcription Lambda
  participant Q as SQS start queue
  participant Worker as start-transcription Lambda
  participant TX as Amazon Transcribe
  participant EB as EventBridge
  participant Done as completion Lambda
  participant Out as S3 transcripts
  participant Hook as webhook/enrichment queues

  Client->>API: POST /v1/uploads/presign
  API->>Upload: Invoke
  Upload->>DDB: Authenticate API key and write PENDING_UPLOAD job
  Upload-->>Client: uploadUrl, jobId, s3Key
  Client->>S3: PUT audio using presigned URL
  Client->>API: POST /v1/transcriptions
  API->>Jobs: Invoke
  Jobs->>DDB: Validate owner, reserve usage, set QUEUED
  Jobs->>S3: HeadObject ownership and size check
  Jobs->>Q: Send durable start request
  Jobs-->>Client: 202 jobId, QUEUED
  Q->>Worker: Deliver message
  Worker->>DDB: Set STARTING
  Worker->>TX: StartTranscriptionJob with speaker labels
  Worker->>DDB: Set IN_PROGRESS
  TX->>Out: Write transcript JSON
  TX->>EB: COMPLETED or FAILED event
  EB->>Done: Invoke completion handler
  Done->>Out: Read transcript JSON when complete
  Done->>DDB: Update status, word count, usage counters
  Done->>Hook: Queue webhook delivery and optional enrichment
  Client->>API: GET /v1/transcriptions/{jobId}
  API->>DDB: Read owned job
  API->>Out: Read transcript or presign JSON URL
  API-->>Client: status, transcriptText, transcriptJsonUrl
```

## Deployment Shape

- AWS backend: deployed from [terraform](../terraform) into an AWS account with Terraform-managed API Gateway, Lambda, IAM, DynamoDB, S3, SQS, EventBridge, CloudWatch Logs, optional alarms, and optional Secrets Manager references.
- Static site: deployed from [landing](../landing) to Cloudflare Pages. It hosts marketing content and API reference only; it is not required for transcription processing.
- CI: GitHub Actions runs Lambda TypeScript checks, Vitest, Lambda bundling, SDK build, Terraform fmt/init/validate, npm audit, Checkov, CodeQL, dependency review, and whitespace checks.
- Private deployment path: customers can deploy the same Terraform stack into their own AWS account and keep uploaded media, transcripts, DynamoDB records, and logs in their account.

## Single-Table DynamoDB Model

| Record | PK | SK | Purpose |
| --- | --- | --- | --- |
| Customer metadata | `CUSTOMER#{customerId}` | `METADATA` | Customer profile, plan, billing state |
| API key | `CUSTOMER#{customerId}` | `APIKEY#{keyId}` | Hashed key, display prefix, limits |
| Billing session | `BILLING_SESSION#{claimToken}` | `METADATA` | Stripe Checkout claim state with TTL |
| Job | `CUSTOMER#{customerId}` | `JOB#{jobId}` | Status, ownership, file metadata, output pointers |
| Transcribe mapping | `TRANSCRIBE#{transcribeJobName}` | `JOB` | Completion-event lookup |
| Webhook | `CUSTOMER#{customerId}` | `WEBHOOK#default` | URL, events, signing secret |
| Enrichment | `CUSTOMER#{customerId}` | `ENRICHMENT#{jobId}` | Optional Bedrock enrichment status and output |
| Monthly usage | `CUSTOMER#{customerId}` | `USAGE#{yyyy-mm}` | Active jobs and reserved seconds |

GSI1 maps `APIKEY#{keyId}` to an API-key record without scanning and maps `STRIPE_CUSTOMER#{stripeCustomerId}` to customer metadata for billing webhooks. GSI2 maps `JOBS#{customerId}` to recent jobs by `createdAt#jobId` for cursor pagination.

## Key Constraints

- No VPC, NAT Gateway, RDS, OpenSearch, provisioned DynamoDB capacity, or always-on workers.
- Lambda runtime is Node.js 20 on arm64.
- API Gateway uses HTTP API for lower cost; REST API usage plans are not used.
- Rate and quota control combine API Gateway stage throttles with Lambda-side per-customer usage counters.
- S3 buckets are private, public access is blocked, and upload access is presigned.
- Stripe billing and Bedrock enrichment are optional and disabled unless configured.
- `sourceUrl` transcription is intentionally not implemented in v1; clients upload to owned S3 keys first.
