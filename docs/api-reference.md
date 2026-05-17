# API Reference

All authenticated routes accept either `x-api-key: <key>` or `Authorization: Bearer <key>`. Errors use a structured JSON body:

```json
{
  "success": false,
  "error": "Invalid or missing API key",
  "code": "UNAUTHORIZED"
}
```

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

Admin-only route protected by `ADMIN_TOKEN` through `Authorization: Bearer` or `x-admin-token`.

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
  "uploadUrl": "https://bucket.s3.amazonaws.com/customers/cust_123/uploads/job_123/meeting.mp3?...",
  "uploadMethod": "PUT",
  "jobId": "2d1d7a53-9f34-40d3-9d2a-839bfb29d821",
  "s3Key": "customers/cust_123/uploads/2d1d7a53-9f34-40d3-9d2a-839bfb29d821/meeting.mp3",
  "expiresInSeconds": 900
}
```

## POST /v1/transcriptions

Starts an asynchronous transcription job from an owned S3 key.

Request with S3 key:

```json
{
  "s3Key": "customers/cust_123/uploads/2d1d7a53-9f34-40d3-9d2a-839bfb29d821/meeting.mp3",
  "fileName": "meeting.mp3",
  "durationSeconds": 600,
  "speakerCount": 2
}
```

Response:

```json
{
  "jobId": "8d1c67c8-89d7-4b2f-9b0e-b15ea5f41c81",
  "status": "IN_PROGRESS"
}
```

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

Returns job status. Completed jobs include `transcriptText` and a short-lived private `transcriptJsonUrl`.

In-progress response:

```json
{
  "jobId": "8d1c67c8-89d7-4b2f-9b0e-b15ea5f41c81",
  "status": "IN_PROGRESS",
  "fileName": "meeting.mp3",
  "durationSeconds": 600,
  "wordCount": 0,
  "failureReason": null,
  "createdAt": "2026-05-16T17:30:00.000Z",
  "updatedAt": "2026-05-16T17:30:00.000Z"
}
```

Completed response:

```json
{
  "jobId": "8d1c67c8-89d7-4b2f-9b0e-b15ea5f41c81",
  "status": "COMPLETED",
  "fileName": "meeting.mp3",
  "durationSeconds": 600,
  "wordCount": 421,
  "failureReason": null,
  "createdAt": "2026-05-16T17:30:00.000Z",
  "updatedAt": "2026-05-16T17:35:22.000Z",
  "transcriptText": "Speaker 1 started the meeting...",
  "transcriptJsonUrl": "https://bucket.s3.amazonaws.com/customers/cust_123/transcripts/job.json?..."
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
      "jobId": "8d1c67c8-89d7-4b2f-9b0e-b15ea5f41c81",
      "status": "COMPLETED",
      "fileName": "meeting.mp3",
      "durationSeconds": 600,
      "wordCount": 421,
      "failureReason": null,
      "createdAt": "2026-05-16T17:30:00.000Z",
      "updatedAt": "2026-05-16T17:35:22.000Z"
    }
  ],
  "nextCursor": null
}
```

## DELETE /v1/transcriptions/{jobId}

Soft deletes a job. It does not delete uploaded audio, transcript JSON, or cancel an already-started Transcribe job.

Response: `204 No Content`
