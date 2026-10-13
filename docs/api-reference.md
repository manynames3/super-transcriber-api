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

Authenticated customer keys with `keys:manage` may create additional keys for their own account. Admin provisioning accepts `x-admin-token` or a bearer admin token. Optional `scopes` restrict keys; callers cannot grant permissions they do not hold. Customer/key hashes are never returned by listing routes.

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
  "apiKey": "stapi_KEY_ID_SECRET_RETURNED_ONLY_ONCE",
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
  "apiKey": "stapi_KEY_ID_SECRET_RETURNED_ONLY_ONCE",
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

Returns job status. Set `includeTranscript=false` for lightweight polling without fetching transcript objects. Completed output also has an authenticated `/transcript?format=txt` download link. Duration is measured by the worker, not taken from the client's hint.

Valid statuses are `PENDING_UPLOAD`, `QUEUED`, `STARTING`, `IN_PROGRESS`, `COMPLETED`, and `FAILED`. Completed jobs include `transcriptText`, a short-lived private `transcriptJsonUrl`, and `enrichmentJsonUrl` when optional AI enrichment has completed.

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
  "id": "2d1d7a53-9f34-40d3-9d2a-839bfb29d821:transcription.completed",
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

## GET /v1/transcriptions/{jobId}/transcript

Protected by `transcriptions:read`. Returns an attachment in `txt` (default), `json`, `srt`, or `vtt`.

```bash
curl "$API_BASE_URL/v1/transcriptions/$JOB_ID/transcript?format=txt" -H "x-api-key: $API_KEY" -o meeting.txt
```

TXT body:

```text
Welcome everyone. Today we are discussing the release.
```

Normalized JSON example:

```json
{
  "jobId": "2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
  "durationSeconds": 60.4,
  "languageCode": "en-US",
  "transcriptText": "Welcome everyone.",
  "wordCount": 2,
  "words": [
    {"text":"Welcome","start":0.4,"end":0.8,"speaker":"spk_0","confidence":0.99},
    {"text":"everyone.","start":0.9,"end":1.4,"speaker":"spk_0","confidence":0.98}
  ],
  "segments": [{"text":"Welcome everyone.","start":0.4,"end":1.4,"speaker":"spk_0"}]
}
```

SRT example:

```text
1
00:00:00,400 --> 00:00:01,400
spk_0: Welcome everyone.
```

VTT uses the same cues with a `WEBVTT` header and decimal timestamp separators. Before completion: `409 TRANSCRIPT_NOT_READY`. Expired output: `410 TRANSCRIPT_EXPIRED` when metadata still exists; expired/removed jobs return 404.

## DELETE /v1/transcriptions/{jobId}/data

Protected by `transcriptions:delete`; permitted even when billing is blocked. Unlike soft deletion, this removes source/sealed audio, transcript/enrichment objects, job/mapping/enrichment records, delivery history, and Transcribe metadata. Aggregate usage and operational logs remain.

```bash
curl -X DELETE "$API_BASE_URL/v1/transcriptions/$JOB_ID/data" -H "x-api-key: $API_KEY"
```

Response: `204 No Content`, including retries after removal. Active processing returns `409 JOB_ACTIVE`. Unexpired upload URLs return `409 UPLOAD_URL_STILL_ACTIVE`; wait until their expiry so a previously issued URL cannot recreate purged audio. Only the authenticated customer's records are addressed.

## GET /v1/api-keys

Requires `keys:manage`. Query parameters: `limit` (1–100) and `cursor`.

```bash
curl "$API_BASE_URL/v1/api-keys?limit=20" -H "x-api-key: $API_KEY"
```

```json
{"items":[{"keyId":"18hexcharacters","keyPrefix":"stapi_18hexcharacters","name":"Integration key","status":"ACTIVE","scopes":["transcriptions:read"],"createdAt":"2026-10-13T00:00:00Z"}],"nextCursor":null}
```

## DELETE /v1/api-keys/{keyId}

Requires `keys:manage`. Revocation is checked with a consistent base-table read.

```bash
curl -X DELETE "$API_BASE_URL/v1/api-keys/$KEY_ID" -H "x-api-key: $API_KEY"
```

```json
{"keyId":"18hexcharacters","status":"DISABLED"}
```

## POST /v1/api-keys/{keyId}/rotate

Requires `keys:manage`. Atomically creates a replacement with the same scopes and revokes the old key.

```bash
curl -X POST "$API_BASE_URL/v1/api-keys/$KEY_ID/rotate" -H "x-api-key: $API_KEY"
```

```json
{"keyId":"new18hexcharacters","keyPrefix":"stapi_new18hexcharacters","apiKey":"stapi_returned_once","scopes":["transcriptions:read"]}
```

Keep the response secure. Do not blindly retry rotation after an uncertain response; the old key may already be revoked.

## GET /v1/webhooks/deliveries

Requires `webhooks:manage`. Lists customer-owned delivery attempts retained for 30 days; supports `limit` and `cursor`. Ordering is by job/event key, not guaranteed chronological order.

```bash
curl "$API_BASE_URL/v1/webhooks/deliveries" -H "x-api-key: $API_KEY"
```

```json
{"items":[{"eventId":"job-id:transcription.completed","jobId":"job-id","status":"DELIVERED","attempts":1,"lastError":null,"updatedAt":"2026-10-13T00:00:00Z","recordType":"DELIVERY","ttlEpochSeconds":1794528000}],"nextCursor":null}
```

## POST /v1/webhooks/deliveries/{eventId}/replay

Requires `webhooks:manage`. URL-encode the event ID and replay only an owned, retained delivery for a visible job.

```bash
curl -X POST "$API_BASE_URL/v1/webhooks/deliveries/$ENCODED_EVENT_ID/replay" -H "x-api-key: $API_KEY"
```

```json
{"eventId":"job-id:transcription.completed","status":"QUEUED"}
```

## Usage, Billing, And Retries

Active jobs are counted across months. Workers measure media and reserve monthly seconds before calling Transcribe; a caller-supplied `durationSeconds` is advisory. Successful jobs consume rounded-up whole seconds; failed jobs refund the reservation. Admission can return 202 followed by a FAILED job if media validation or monthly quota checks fail.

`GET /v1/billing/account` also returns:

```json
{"usage":{"usageMonth":"2026-10","activeJobs":1,"reservedSeconds":62,"usedSeconds":120,"completedJobs":2,"failedJobs":0,"usedMinutes":2,"reservedMinutes":1.0333333333,"remainingMinutes":116.9666666667}}
```

Subscription changes apply to existing keys. Checkout/claim are public routes, protected by payment verification and a secret receipt rather than API-key authentication. Receipts expire after 24 hours. Repeat `POST /v1/billing/claim` with `recover:true` to replace a lost receipt-issued key after verifying an active subscription; other keys remain active. After receipt expiry, an admin must verify ownership and provision a replacement.

Identical transcription submissions for the same upload and speaker/language options return the existing job. Different options return 409. GET/DELETE and same-upload starts are safe to retry. Presign/key/checkout creation and rotation return new resources or one-time secrets and should not be retried blindly.

Rate limits default to 120 requests per key per minute with a `Retry-After` header on 429. Job/minute quotas are per customer. HTTP API usage plans are not used. Webhooks have a stable `id`; deduplicate by that ID, verify HMAC over the raw body, and reject timestamps outside a five-minute window. Delivery uses public HTTPS endpoints on port 443, validates DNS addresses, and does not follow redirects.
