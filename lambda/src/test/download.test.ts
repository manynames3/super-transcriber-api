import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), requireJob: vi.fn(), read: vi.fn() }));
vi.mock("../shared/auth.js", () => ({ authenticate: mocks.auth }));
vi.mock("../shared/dynamodb.js", () => ({ requireVisibleJob: mocks.requireJob }));
vi.mock("../shared/transcript-storage.js", () => ({ readTranscript: mocks.read }));
import { handler } from "../handlers/download-transcript.js";
import { notFound } from "../shared/errors.js";
import { apiEvent, job } from "./fixtures.js";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ customerId: "cust_test" }); mocks.requireJob.mockResolvedValue({ ...job, status: "COMPLETED" }); mocks.read.mockResolvedValue({ results: { transcripts: [{ transcript: "Hello team." }] } }); });
it("returns a real TXT attachment", async () => {
  const response = await handler(apiEvent("GET /v1/transcriptions/{jobId}/transcript", { pathParameters: { jobId: job.jobId } }));
  expect(response.statusCode).toBe(200); expect(response.body).toBe("Hello team.");
  expect(response.headers?.["content-type"]).toBe("text/plain; charset=utf-8");
});
it("cannot retrieve another customer's transcript", async () => {
  mocks.requireJob.mockRejectedValue(notFound("Transcription job not found"));
  const response = await handler(apiEvent("GET /v1/transcriptions/{jobId}/transcript", { pathParameters: { jobId: "another-job" } }));
  expect(response.statusCode).toBe(404); expect(mocks.read).not.toHaveBeenCalled();
});
