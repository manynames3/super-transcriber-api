# API Reference

All authenticated routes accept either `x-api-key: <key>` or `Authorization: Bearer <key>`. Errors use a structured JSON body:

```json
{
  "success": false,
  "error": "Invalid or missing API key",
  "code": "UNAUTHORIZED"
}
```

## GET /

Public API root status endpoint. This returns the same basic health payload as `GET /health`, so opening the deployed API base URL in a browser gives a useful response instead of API Gateway's default `404`.

## GET /health

Public health endpoint.

Response:

```json
{
  "ok": true,
  "service": "super-transcriber-api",
  "version": "dev-local",
  "requestId": "req-123"
}
```

## POST /v1/api-keys

Admin-only route protected by the Secrets Manager-backed admin token through `Authorization: Bearer` or `x-admin-token`.

Request:

```json
{
  "customerName": "Acme Dev",
  "keyName": "Local dev key",
  "limits": {
    "maxActiveJobs": 5,
    "maxFileSizeBytes": 209715200,
    "maxDurationSeconds": 1200,
    "monthlyTranscriptionMinutes": 120
  }
}
```

## POST /v1/billing/checkout

Public route that creates a Stripe Checkout session for a configured paid plan. This works with the API Gateway URL; a custom domain is optional.

Request:

```json
{
  "email": "dev@example.com",
  "planId": "starter"
}
```

`successUrl` and `cancelUrl` are optional. When omitted, the API uses the deployed API Gateway health URL as the Stripe redirect target. If provided, they must be HTTPS URLs except for localhost development.

Response:

```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
  "checkoutSessionId": "cs_test_123",
  "claimToken": "opaque_claim_token",
  "expiresAt": "2026-05-17T17:30:00.000Z"
}
```

## POST /v1/billing/claim

Public route that verifies a paid Stripe Checkout session and returns the plaintext API key once.

Request:

```json
{
  "checkoutSessionId": "cs_test_123",
  "claimToken": "opaque_claim_token"
}
```

Response:

```json
{
  "customerId": "cust_8d7f2a1c4b3e9a00",
  "planId": "starter",
  "billingStatus": "ACTIVE",
  "keyId": "2f4d6e8a0b1c2d3e4f",
  "keyPrefix": "stapi_2f4d6e8a0b1c2d3e4f",
  "apiKey": "stapi_2f4d6e8a0b1c2d3e4f_plaintext-secret-returned-once",
  "createdAt": "2026-05-16T17:30:00.000Z"
}
```

## GET /v1/billing/account

Authenticated route that returns the current customer billing status and enforced limits.

Response:

```json
{
  "customerId": "cust_8d7f2a1c4b3e9a00",
  "planId": "starter",
  "billingStatus": "ACTIVE",
  "limits": {
    "maxActiveJobs": 5,
    "maxFileSizeBytes": 209715200,
    "maxDurationSeconds": 1200,
    "monthlyTranscriptionMinutes": 120
  },
  "stripeCustomerId": "cus_123"
}
```

## POST /v1/billing/portal

Authenticated route that creates a Stripe Billing Portal session so customers can manage payment methods and subscriptions.

Request:

```json
{
  "returnUrl": "https://example.com/account"
}
```

Response:

```json
{
  "portalUrl": "https://billing.stripe.com/p/session/..."
}
```

## POST /v1/billing/webhook

Public Stripe webhook endpoint. Configure this URL in Stripe using the deployed API Gateway URL:

```text
https://{api-id}.execute-api.{region}.amazonaws.com/v1/billing/webhook
```

Response:

```json
{
  "customerId": "cust_8d7f2a1c4b3e9a00",
  "keyId": "2f4d6e8a0b1c2d3e4f",
  "keyPrefix": "stapi_2f4d6e8a0b1c2d3e4f",
  "apiKey": "stapi_2f4d6e8a0b1c2d3e4f_plaintext-secret-returned-once",
  "createdAt": "2026-05-16T17:30:00.000Z"
}
```

## POST /v1/uploads/presign

Creates a private S3 presigned upload URL. Supports `.mp3` and `.m4a` only, with a default 200 MB maximum.

Request:

```json
{
  "fileName": "meeting.mp3",
  "contentType": "audio/mpeg",
  "fileSizeBytes": 1048576
}
```

Response:

```json
{
  "uploadUrl": "https://bucket.s3.amazonaws.com/customers/cust_123/uploads/2d1d7a53-9f34-40d3-9d2a-839bfb29d821/meeting.mp3?...",
  "uploadMethod": "PUT",
  "uploadHeaders": {
    "content-type": "audio/mpeg"
  },
  "jobId": "2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
  "s3Key": "customers/cust_123/uploads/2d1d7a53-9f34-40d3-9d2a-839bfb29d821/meeting.mp3",
  "expiresInSeconds": 900,
  "startRequest": {
    "s3Key": "customers/cust_123/uploads/2d1d7a53-9f34-40d3-9d2a-839bfb29d821/meeting.mp3",
    "fileName": "meeting.mp3"
  },
  "pollUrl": "/v1/transcriptions/2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
  "links": {
    "startTranscription": "/v1/transcriptions",
    "jobStatus": "/v1/transcriptions/2d1d7a53-9f34-40d3-9d2a-839bfb29d821"
  }
}
```

The returned `jobId` is reserved from the upload path and is reused as the transcription job id after `POST /v1/transcriptions`.

## POST /v1/transcriptions

Queues an asynchronous transcription job from an owned S3 key. The API writes `QUEUED`, sends a durable SQS message, and a worker Lambda starts Amazon Transcribe.

Request with S3 key:

```json
{
  "s3Key": "customers/cust_123/uploads/2d1d7a53-9f34-40d3-9d2a-839bfb29d821/meeting.mp3",
  "durationSeconds": 600,
  "speakerCount": 2
}
```

Response:

```json
{
  "jobId": "2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
  "status": "QUEUED",
  "pollUrl": "/v1/transcriptions/2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
  "links": {
    "self": "/v1/transcriptions/2d1d7a53-9f34-40d3-9d2a-839bfb29d821"
  }
}
```

`fileName` may be omitted for presigned uploads because the API can infer it from the `s3Key`. If provided, it must match the file name in the key.

Request with `sourceUrl`:

```json
{
  "sourceUrl": "s3://external-bucket/audio/meeting.mp3",
  "fileName": "meeting.mp3"
}
```

Response:

```json
{
  "success": false,
  "error": "sourceUrl transcription is not implemented in v1; upload to S3 with a presigned URL first",
  "code": "NOT_IMPLEMENTED"
}
```

## GET /v1/transcriptions/{jobId}

Returns job status. Valid statuses are `PENDING_UPLOAD`, `QUEUED`, `STARTING`, `IN_PROGRESS`, `COMPLETED`, and `FAILED`. Completed jobs include `transcriptText`, a short-lived private `transcriptJsonUrl`, and `enrichmentJsonUrl` when optional AI enrichment has completed.

In-progress response:

```json
{
  "jobId": "2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
  "status": "IN_PROGRESS",
  "fileName": "meeting.mp3",
  "durationSeconds": 600,
  "wordCount": 0,
  "failureReason": null,
  "createdAt": "2026-05-16T17:30:00.000Z",
  "updatedAt": "2026-05-16T17:30:00.000Z",
  "links": {
    "self": "/v1/transcriptions/2d1d7a53-9f34-40d3-9d2a-839bfb29d821"
  }
}
```

Completed response:

```json
{
  "jobId": "2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
  "status": "COMPLETED",
  "fileName": "meeting.mp3",
  "durationSeconds": 600,
  "wordCount": 421,
  "failureReason": null,
  "createdAt": "2026-05-16T17:30:00.000Z",
  "updatedAt": "2026-05-16T17:35:22.000Z",
  "transcriptText": "Speaker 1 started the meeting...",
  "transcriptJsonUrl": "https://bucket.s3.amazonaws.com/customers/cust_123/transcripts/job.json?...",
  "enrichmentJsonUrl": "https://bucket.s3.amazonaws.com/customers/cust_123/enrichments/job.json?...",
  "links": {
    "self": "/v1/transcriptions/2d1d7a53-9f34-40d3-9d2a-839bfb29d821"
  }
}
```

## GET /v1/transcriptions

Lists recent non-deleted jobs for the authenticated customer. Pagination uses an opaque cursor.

Request:

```bash
curl "$API_BASE_URL/v1/transcriptions?limit=20&cursor=$CURSOR" -H "x-api-key: $API_KEY"
```

Response:

```json
{
  "items": [
    {
      "jobId": "2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
      "status": "COMPLETED",
      "fileName": "meeting.mp3",
      "durationSeconds": 600,
      "wordCount": 421,
      "failureReason": null,
      "createdAt": "2026-05-16T17:30:00.000Z",
      "updatedAt": "2026-05-16T17:35:22.000Z",
      "links": {
        "self": "/v1/transcriptions/2d1d7a53-9f34-40d3-9d2a-839bfb29d821"
      }
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

## DELETE /v1/transcriptions/{jobId}

Soft deletes a job. It does not delete uploaded audio, transcript JSON, or cancel an already-started Transcribe job.

Response: `204 No Content`

## POST /v1/webhooks

Configures the authenticated customer's default completion webhook. Payloads are signed with `x-super-transcriber-signature` using `HMAC-SHA256` over `{timestamp}.{payload}`. The signing secret is returned only when the webhook is first created.

Request:

```json
{
  "url": "https://example.com/webhooks/super-transcriber",
  "events": ["transcription.completed", "transcription.failed"],
  "enabled": true
}
```

Response:

```json
{
  "url": "https://example.com/webhooks/super-transcriber",
  "events": ["transcription.completed", "transcription.failed"],
  "enabled": true,
  "signingSecret": "whsec_returned_once_for_new_webhooks"
}
```

Example webhook payload:

```json
{
  "id": "4c94c9e8-9cb2-4b9d-9b3b-63d3eb5a935a",
  "type": "transcription.completed",
  "createdAt": "2026-05-16T17:35:22.000Z",
  "data": {
    "jobId": "2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
    "status": "COMPLETED",
    "fileName": "meeting.mp3",
    "durationSeconds": 600,
    "wordCount": 421,
    "failureReason": null,
    "createdAt": "2026-05-16T17:30:00.000Z",
    "updatedAt": "2026-05-16T17:35:22.000Z"
  }
}
```
