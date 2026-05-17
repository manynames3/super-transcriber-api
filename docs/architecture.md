# Architecture

Super Transcriber API is intentionally small: API Gateway HTTP API, Lambda, DynamoDB, S3, Amazon Transcribe, EventBridge, SQS DLQ, and CloudWatch Logs. Terraform is the only active infrastructure path.

## Container Diagram

```mermaid
flowchart LR
  Developer["External developer or team"] -->|REST JSON and API key| Api["API Gateway HTTP API"]
  Api --> Health["health Lambda"]
  Api --> Admin["create-api-key Lambda"]
  Api --> Upload["presign-upload Lambda"]
  Api --> Jobs["transcription Lambdas"]

  Upload -->|presigned PUT| Uploads["S3 uploads bucket"]
  Jobs -->|read/write items| Table["DynamoDB single table"]
  Admin -->|hashed API key records| Table
  Jobs -->|StartTranscriptionJob| Transcribe["Amazon Transcribe"]
  Transcribe -->|read audio| Uploads
  Transcribe -->|write JSON| Transcripts["S3 transcripts bucket"]
  Transcribe -->|job state event| EventBridge["EventBridge rule"]
  EventBridge --> Completion["completion Lambda"]
  EventBridge -. failures .-> Dlq["SQS DLQ"]
  Completion --> Table
  Completion --> Transcripts
  Jobs --> Transcripts
  Health --> Logs["CloudWatch Logs"]
  Admin --> Logs
  Upload --> Logs
  Jobs --> Logs
  Completion --> Logs
```

## Runtime Flow

```mermaid
sequenceDiagram
  participant Client
  participant API as HTTP API
  participant Lambda as Lambda handlers
  participant DDB as DynamoDB
  participant S3 as S3 uploads
  participant TX as Amazon Transcribe
  participant EB as EventBridge
  participant Out as S3 transcripts

  Client->>API: POST /v1/uploads/presign
  API->>Lambda: presign-upload
  Lambda->>DDB: query APIKEY by key id
  Lambda-->>Client: uploadUrl, jobId, s3Key
  Client->>S3: PUT audio with presigned URL
  Client->>API: POST /v1/transcriptions
  API->>Lambda: create-transcription
  Lambda->>DDB: reserve monthly usage and active job
  Lambda->>S3: HeadObject for ownership and size
  Lambda->>DDB: write JOB and TRANSCRIBE mapping
  Lambda->>TX: StartTranscriptionJob with speaker labels
  Lambda-->>Client: 202 jobId, IN_PROGRESS
  TX->>Out: write transcript JSON
  TX->>EB: COMPLETED or FAILED event
  EB->>Lambda: completion handler
  Lambda->>Out: read transcript JSON on completion
  Lambda->>DDB: update job and active usage
  Client->>API: GET /v1/transcriptions/{jobId}
  API->>Lambda: get-transcription
  Lambda->>Out: read transcript JSON and presign JSON URL
  Lambda-->>Client: status and transcriptText
```

## Single-Table Access Patterns

| Record | PK | SK | Purpose |
| --- | --- | --- | --- |
| Customer metadata | `CUSTOMER#{customerId}` | `METADATA` | Customer profile |
| API key | `CUSTOMER#{customerId}` | `APIKEY#{keyId}` | Hashed API key and limits |
| Job | `CUSTOMER#{customerId}` | `JOB#{jobId}` | Job status and ownership |
| Transcribe mapping | `TRANSCRIBE#{transcribeJobName}` | `JOB` | Completion event lookup |
| Monthly usage | `CUSTOMER#{customerId}` | `USAGE#{yyyy-mm}` | Active jobs and reserved seconds |

GSI1 maps `APIKEY#{keyId}` to the API key record without scans. GSI2 maps `JOBS#{customerId}` to recent jobs by `createdAt#jobId` for cursor pagination.

## Cost-First Constraints

The stack avoids fixed monthly network and database services. There is no VPC, NAT Gateway, RDS, provisioned DynamoDB capacity, or always-on worker. Rate and usage control live in API Gateway stage throttles plus Lambda-side customer counters. AWS API Gateway usage plans are documented for REST APIs, while this stack uses HTTP API for lower cost and simpler routing.
