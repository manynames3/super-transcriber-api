import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), job: vi.fn(), state: vi.fn(), s3: vi.fn(), transcribe: vi.fn(), db: vi.fn() }));
vi.mock("../shared/auth.js", () => ({ authenticate: mocks.auth }));
vi.mock("../shared/dynamodb.js", () => ({ getJob: mocks.job, tableName: "test-table", client: { send: mocks.db } }));
vi.mock("../shared/transcribe.js", () => ({ getTranscribeJobStatus: mocks.state }));
vi.mock("@aws-sdk/client-s3", async original => ({ ...(await original<typeof import("@aws-sdk/client-s3")>()), S3Client: class { send = mocks.s3; } }));
vi.mock("@aws-sdk/client-transcribe", async original => ({ ...(await original<typeof import("@aws-sdk/client-transcribe")>()), TranscribeClient: class { send = mocks.transcribe; } }));
import { handler } from "../handlers/purge-transcription.js";
import { job, apiEvent } from "./fixtures.js";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ customerId: job.customerId }); mocks.job.mockResolvedValue({ ...job, status: "COMPLETED", uploadExpiresAt: "2020-01-01T00:00:00Z", processingS3Key: "sealed/audio.mp3" }); mocks.state.mockResolvedValue({ status: "COMPLETED" }); });
it("removes all media and metadata for an eligible owned job", async () => {
  expect((await handler(apiEvent("DELETE /v1/transcriptions/{jobId}/data", { pathParameters: { jobId: job.jobId } }))).statusCode).toBe(204);
  expect(mocks.s3).toHaveBeenCalledTimes(4); expect(mocks.transcribe).toHaveBeenCalledTimes(1); expect(mocks.db).toHaveBeenCalledTimes(1);
});
it("does not remove data while the issued upload URL is still valid", async () => {
  mocks.job.mockResolvedValue({ ...job, status: "COMPLETED", uploadExpiresAt: new Date(Date.now() + 60000).toISOString() });
  expect((await handler(apiEvent("DELETE /v1/transcriptions/{jobId}/data"))).statusCode).toBe(409);
  expect(mocks.s3).not.toHaveBeenCalled();
});
it("rejects purge when Transcribe is still active despite a locally failed job", async () => {
  mocks.state.mockResolvedValue({ status: "IN_PROGRESS" });
  expect((await handler(apiEvent("DELETE /v1/transcriptions/{jobId}/data"))).statusCode).toBe(409);
  expect(mocks.s3).not.toHaveBeenCalled();
});
it("does not erase metadata after an S3 deletion failure", async () => {
  mocks.s3.mockRejectedValueOnce(new Error("S3 unavailable"));
  expect((await handler(apiEvent("DELETE /v1/transcriptions/{jobId}/data"))).statusCode).toBe(500);
  expect(mocks.db).not.toHaveBeenCalled();
});
