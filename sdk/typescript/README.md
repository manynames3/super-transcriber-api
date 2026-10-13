# Super Transcriber API Client

Typed client for private uploads, asynchronous transcription, TXT/JSON/SRT/VTT downloads, signed webhooks, API keys, and optional billing.

Install the release package (Node.js 22+):

```bash
npm install https://github.com/manynames3/super-transcriber-api/releases/download/v1.0.0/super-transcriber-api-client-1.0.0.tgz
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
const subtitles = await client.downloadTranscript(job.jobId, "vtt");
```

For asynchronous applications, use `transcribeUpload()` to return as soon as the job is accepted, then a webhook or `waitForCompletion()`. Request timeouts default to 30 seconds (uploads: 5 minutes); polling waits default to 30 minutes. An aborted client wait does not cancel the server job.

GET/DELETE and same-upload transcription starts retry transient failures up to twice. Presign, checkout, key creation/rotation, and webhook configuration do not retry automatically because they create resources or return one-time secrets. Errors expose `code`, `status`, and `retryAfterSeconds` through `SuperTranscriberError`.

`verifyWebhookSignature(secret, rawBody, signatureHeader)` uses Web Crypto HMAC verification and a five-minute timestamp tolerance. Deduplicate callbacks by their stable `id`. Keep API keys on your backend; presigned S3 uploads do not carry API-key headers.

The package is downloadable from GitHub Releases. npm registry publication requires a maintainer account with permission to publish the package scope.

Copyright 2026 SUPREME AI VENTURES LLC. Repository licensing applies.
