import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { SuperTranscriberClient } from "../sdk/typescript/dist/index.js";

const require = createRequire(new URL("../lambda/package.json", import.meta.url));
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const baseUrl = process.env.API_BASE_URL ?? "https://pn72sppog0.execute-api.us-east-1.amazonaws.com";
const secretArn = process.env.ADMIN_TOKEN_SECRET_ARN;
if (!secretArn || process.argv.length < 3) throw new Error("Set ADMIN_TOKEN_SECRET_ARN and supply an MP3/M4A sample path");
const secret = await new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" }).send(new GetSecretValueCommand({ SecretId: secretArn }));
let adminToken = secret.SecretString;
try { adminToken = JSON.parse(adminToken).adminToken ?? adminToken; } catch {}
if (!adminToken) throw new Error("Admin secret is empty");
async function provision(limits) {
  const response = await fetch(baseUrl + "/v1/api-keys", { method: "POST", headers: { "x-admin-token": adminToken, "content-type": "application/json" },
    body: JSON.stringify({ customerId: "smoke_" + randomUUID().replace(/-/g, "").slice(0, 16), customerName: "Release smoke test", limits }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Provision failed: ${body.code}: ${body.error}`);
  return body;
}
const primary = await provision();
const client = new SuperTranscriberClient({ baseUrl, apiKey: primary.apiKey });
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/smoke-credentials.json", JSON.stringify(primary), { mode: 0o600 });
const results = [];
for (const path of process.argv.slice(2)) {
  const audio = new Blob([await readFile(path)]);
  const fileName = path.split(/[\\/]/).at(-1);
  const started = performance.now();
  const queued = await client.transcribeUpload({ fileName, contentType: fileName.endsWith(".mp3") ? "audio/mpeg" : "audio/mp4", fileSizeBytes: audio.size }, audio, { speakerCount: 1, durationSeconds: 1 });
  const job = await client.waitForCompletion(queued.jobId, { pollIntervalMs: 5000, timeoutMs: 600000 });
  assert.ok(job.transcriptText?.length); assert.ok(job.durationSeconds > 1);
  const formats = {};
  for (const format of ["txt", "json", "srt", "vtt"]) {
    const output = await client.downloadTranscript(job.jobId, format); assert.ok(output.length > 0); formats[format] = output.length;
    if (format === "vtt") assert.ok(output.startsWith("WEBVTT"));
    if (format === "json") assert.ok(JSON.parse(output).words.length > 0);
  }
  results.push({ jobId: job.jobId, fileName, durationSeconds: job.durationSeconds, elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3)), wordCount: job.wordCount, formats });
  console.log(`Verified ${fileName}: ${job.status}, ${job.wordCount} words, ${job.durationSeconds.toFixed(3)} seconds`);
}
const account = await client.getBillingAccount();
assert.equal(account.usage.activeJobs, 0); assert.equal(account.usage.reservedSeconds, 0);
assert.equal(account.usage.usedSeconds, results.reduce((sum, item) => sum + Math.ceil(item.durationSeconds), 0));
const other = await provision();
const otherClient = new SuperTranscriberClient({ baseUrl, apiKey: other.apiKey });
await assert.rejects(otherClient.getTranscription(results[0].jobId), error => error.status === 404);
const scoped = await client.createApiKey({ keyName: "Read-only smoke key", scopes: ["transcriptions:read"] });
const scopedClient = new SuperTranscriberClient({ baseUrl, apiKey: scoped.apiKey });
await assert.rejects(scopedClient.presignUpload({ fileName: "blocked.mp3", contentType: "audio/mpeg", fileSizeBytes: 1 }), error => error.status === 403);
const rotated = await client.rotateApiKey(scoped.keyId);
await assert.rejects(scopedClient.getTranscription(results[0].jobId), error => error.status === 401);
await client.revokeApiKey(rotated.keyId);
await assert.rejects(new SuperTranscriberClient({ baseUrl, apiKey: rotated.apiKey }).getTranscription(results[0].jobId), error => error.status === 401);
const small = await provision({ maxDurationSeconds: 1 });
const smallClient = new SuperTranscriberClient({ baseUrl, apiKey: small.apiKey });
const filePath = process.argv[2], file = new Blob([await readFile(filePath)]);
const rejected = await smallClient.transcribeUpload({ fileName: "over-limit.mp3", contentType: "audio/mpeg", fileSizeBytes: file.size }, file, { durationSeconds: 1 });
await assert.rejects(smallClient.waitForCompletion(rejected.jobId, { pollIntervalMs: 5000, timeoutMs: 180000 }), error => error.code === "TRANSCRIPTION_FAILED");
const smallUsage = await smallClient.getBillingAccount();
assert.equal(smallUsage.usage.activeJobs, 0); assert.equal(smallUsage.usage.usedSeconds, 0); assert.equal(smallUsage.usage.reservedSeconds, 0);
const report = { recordedAt: new Date().toISOString(), apiBaseUrl: baseUrl, results, usage: account.usage, checks: { ownership: true, scopeRestriction: true, rotationRevocation: true, durationHintCannotBypassLimit: true, failedUsageReleased: true } };
await writeFile("artifacts/smoke-report.json", JSON.stringify(report, null, 2) + "\n");
console.log("Live smoke checks passed; keys were not printed. Report: artifacts/smoke-report.json");
