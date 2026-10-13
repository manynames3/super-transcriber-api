import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { SuperTranscriberClient, SuperTranscriberError, verifyWebhookSignature } from "../dist/index.js";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("transcribeFile uploads privately, starts once, polls, and returns text", async () => {
  const requests = [];
  let reads = 0;
  const client = new SuperTranscriberClient({ baseUrl: "https://api.example", apiKey: "test-secret", fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/presign")) return json({ uploadUrl: "https://s3.example/audio", uploadMethod: "PUT", uploadHeaders: { "content-type": "audio/mpeg" },
      jobId: "job-1", s3Key: "owned/audio", startRequest: { fileName: "meeting.mp3" } });
    if (url.startsWith("https://s3.example")) return new Response(null, { status: 200 });
    if (options.method === "POST") return json({ jobId: "job-1", status: "QUEUED" }, 202);
    reads++;
    return json({ jobId: "job-1", status: reads === 1 ? "IN_PROGRESS" : "COMPLETED", transcriptText: reads >= 3 ? "Hello team." : undefined });
  } });
  const job = await client.transcribeFile(new Blob(["audio"], { type: "audio/mpeg" }), { fileName: "meeting.mp3", pollIntervalMs: 1 });
  assert.equal(job.transcriptText, "Hello team.");
  const upload = requests.find(request => request.url.startsWith("https://s3.example"));
  assert.equal(upload.options.headers["x-api-key"], undefined);
  assert.equal(requests.filter(request => request.url.endsWith("/v1/transcriptions") && request.options.method === "POST").length, 1);
  assert.equal(JSON.parse(requests[2].options.body).fileName, "meeting.mp3");
});

test("safe GET requests honor Retry-After", async () => {
  let calls = 0;
  const client = new SuperTranscriberClient({ baseUrl: "https://api.example", apiKey: "secret", fetchImpl: async () => {
    calls++; return calls === 1 ? json({ code: "QUOTA_EXCEEDED", error: "Retry" }, 429, { "retry-after": "0.001" }) : json({ jobId: "id", status: "COMPLETED" });
  } });
  assert.equal((await client.getTranscription("id")).status, "COMPLETED");
  assert.equal(calls, 2);
});

test("presign POST is not blindly retried and retains structured errors", async () => {
  let calls = 0;
  const client = new SuperTranscriberClient({ baseUrl: "https://api.example", apiKey: "secret", fetchImpl: async () => {
    calls++; return json({ code: "UNAVAILABLE", error: "Try later" }, 503);
  } });
  await assert.rejects(client.presignUpload({ fileName: "a.mp3", contentType: "audio/mpeg", fileSizeBytes: 1 }), error => {
    assert.ok(error instanceof SuperTranscriberError); assert.equal(error.code, "UNAVAILABLE"); assert.equal(error.status, 503); return true;
  });
  assert.equal(calls, 1);
});

test("failed jobs produce a typed failure without polling forever", async () => {
  const client = new SuperTranscriberClient({ baseUrl: "https://api.example", apiKey: "secret", fetchImpl: async () => json({ status: "FAILED", failureReason: "Invalid audio" }) });
  await assert.rejects(client.waitForCompletion("id"), error => error.code === "TRANSCRIPTION_FAILED");
});

test("canceling the client wait stops polling", async () => {
  const controller = new AbortController();
  const client = new SuperTranscriberClient({ baseUrl: "https://api.example", apiKey: "secret", fetchImpl: async () => json({ status: "QUEUED" }) });
  const wait = client.waitForCompletion("id", { signal: controller.signal });
  controller.abort();
  await assert.rejects(wait, error => error.name === "AbortError");
});

test("webhook verification rejects tampering and stale signatures", async () => {
  const timestamp = new Date().toISOString();
  const payload = '{"id":"stable-event","type":"transcription.completed"}';
  const signature = `t=${timestamp},v1=${createHmac("sha256", "secret").update(`${timestamp}.${payload}`).digest("hex")}`;
  assert.equal(await verifyWebhookSignature("secret", payload, signature), true);
  assert.equal(await verifyWebhookSignature("secret", payload + " ", signature), false);
  assert.equal(await verifyWebhookSignature("secret", payload, signature, 300, Date.now() + 600000), false);
});
