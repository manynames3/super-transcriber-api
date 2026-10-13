import { beforeEach, expect, it, vi } from "vitest";
import type { SQSEvent } from "aws-lambda";
const mocks = vi.hoisted(() => ({ getJob: vi.fn(), starting: vi.fn(), progress: vi.fn(), verify: vi.fn(), reserve: vi.fn(), finish: vi.fn(), transcribe: vi.fn() }));
vi.mock("../shared/dynamodb.js", () => ({ getJob: mocks.getJob, markJobStarting: mocks.starting, markJobInProgress: mocks.progress }));
vi.mock("../shared/ledger.js", () => ({ reserveVerifiedUsage: mocks.reserve, finishJob: mocks.finish }));
vi.mock("../shared/media.js", () => ({ verifyAudio: mocks.verify }));
vi.mock("../shared/transcribe.js", () => ({ startTranscribeJob: mocks.transcribe }));
import { handler } from "../handlers/start-transcription.js";
import { quotaExceeded } from "../shared/errors.js";
import { job } from "./fixtures.js";
const event = { Records: [{ messageId: "msg", body: JSON.stringify({ customerId: job.customerId, jobId: job.jobId }), attributes: { ApproximateReceiveCount: "1" } }] } as SQSEvent;
beforeEach(() => { vi.resetAllMocks(); mocks.getJob.mockResolvedValue({ ...job, status: "QUEUED", usageReserved: false, durationSeconds: 1, processingS3Key: "sealed/audio.mp3" }); mocks.starting.mockResolvedValue(true); mocks.verify.mockResolvedValue(61.4); mocks.reserve.mockResolvedValue({ ...job, processingS3Key: "sealed/audio.mp3" }); });
it("reserves verified audio duration rather than the client's hint", async () => {
  expect(await handler(event)).toEqual({ batchItemFailures: [] });
  expect(mocks.reserve).toHaveBeenCalledWith(expect.anything(), 61.4);
  expect(mocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({ s3Key: "sealed/audio.mp3" }));
});
it("does not start Transcribe when measured usage exceeds quota", async () => {
  mocks.reserve.mockRejectedValue(quotaExceeded("Monthly limit"));
  await handler(event); expect(mocks.transcribe).not.toHaveBeenCalled();
  expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), "FAILED", { failureReason: "Monthly limit" });
});
it("a competing worker cannot start a job with an active lease", async () => {
  mocks.starting.mockResolvedValue(false); await handler(event);
  expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.transcribe).not.toHaveBeenCalled();
});
