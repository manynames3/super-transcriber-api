import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getOutbox: vi.fn(), markDispatched: vi.fn(), getJob: vi.fn(), send: vi.fn() }));
vi.mock("../shared/ledger.js", () => ({ getOutbox: mocks.getOutbox, markDispatched: mocks.markDispatched }));
vi.mock("../shared/dynamodb.js", () => ({ getJob: mocks.getJob }));
vi.mock("../shared/queue.js", () => ({ enqueueWebhookDelivery: mocks.send, enqueueTranscriptionStart: mocks.send, enqueueEnrichment: mocks.send }));
import { dispatchOutbox } from "../shared/outbox.js";
import type { OutboxRecord } from "../shared/ledger.js";
const record: OutboxRecord = { PK: "OUTBOX#event", SK: "EVENT", recordType: "OUTBOX", id: "event", kind: "webhook", customerId: "cust", jobId: "job", eventType: "transcription.completed", status: "PENDING", createdAt: "2026-10-13T00:00:00Z" };
beforeEach(() => { vi.resetAllMocks(); mocks.getOutbox.mockResolvedValue(record); mocks.getJob.mockResolvedValue({ jobId: "job" }); });
it("leaves the event pending when SQS fails so replay can finish it", async () => {
  mocks.send.mockRejectedValueOnce(new Error("SQS interrupted"));
  await expect(dispatchOutbox(record)).rejects.toThrow("SQS interrupted");
  expect(mocks.markDispatched).not.toHaveBeenCalled();
  mocks.send.mockResolvedValueOnce(undefined);
  await dispatchOutbox(record);
  expect(mocks.markDispatched).toHaveBeenCalledWith("event");
  expect(mocks.send.mock.calls[0][0].id).toBe(mocks.send.mock.calls[1][0].id);
});
it("ignores already dispatched events", async () => {
  mocks.getOutbox.mockResolvedValue({ ...record, status: "DISPATCHED" });
  await dispatchOutbox(record); expect(mocks.send).not.toHaveBeenCalled();
});
