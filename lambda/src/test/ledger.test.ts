import { beforeEach, describe, expect, it, vi } from "vitest";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
const mocks = vi.hoisted(() => ({ send: vi.fn<(command: unknown) => Promise<Record<string, unknown>>>() }));
vi.mock("@aws-sdk/lib-dynamodb", async importOriginal => ({ ...(await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>()), DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) } }));
import { finishJob, queueJob, reserveVerifiedUsage } from "../shared/ledger.js";
import { job } from "./fixtures.js";

const send = mocks.send;
beforeEach(() => send.mockReset());

describe("atomic usage and completion", () => {
  it("settles capacity, verified usage, and durable callback in one transaction", async () => {
    send.mockResolvedValueOnce({ Item: job }).mockResolvedValueOnce({});
    expect(await finishJob(job, "COMPLETED", { wordCount: 12 })).toBe(true);
    const command = send.mock.calls[1][0] as TransactWriteCommand;
    const items = command.input.TransactItems!;
    expect(items).toHaveLength(4);
    const usage = items.find(item => item.Update?.Key?.SK === "USAGE#2026-10")!.Update!;
    expect(usage.ExpressionAttributeValues).toMatchObject({ ":refund": -62, ":used": 62 });
    expect(items.find(item => item.Put?.Item?.recordType === "OUTBOX")!.Put!.Item).toMatchObject({ id: `${job.jobId}:transcription.completed`, status: "PENDING" });
  });
  it("does not charge or emit again when completion is replayed", async () => {
    send.mockResolvedValueOnce({ Item: { ...job, status: "COMPLETED" } });
    expect(await finishJob(job, "COMPLETED")).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps failure settlement retryable if the transaction is interrupted", async () => {
    send.mockResolvedValueOnce({ Item: job }).mockRejectedValueOnce(new Error("Network interrupted"));
    await expect(finishJob(job, "FAILED")).rejects.toThrow("Network interrupted");
    send.mockResolvedValueOnce({ Item: job }).mockResolvedValueOnce({});
    expect(await finishJob(job, "FAILED")).toBe(true);
    const command = send.mock.calls[3][0] as TransactWriteCommand;
    expect(command.input.TransactItems!.find(item => item.Update?.Key?.SK === "USAGE#2026-10")!.Update!.ExpressionAttributeValues).toMatchObject({ ":refund": -62, ":used": 0 });
  });
  it("makes same-upload submission idempotent and rejects changed options", async () => {
    const queued = { ...job, status: "QUEUED" as const, requestHash: "same" };
    expect(await queueJob(queued, job.limits!, "same", { uploadETag: "tag", keyId: "key" })).toBe(queued);
    expect(send).not.toHaveBeenCalled();
    await expect(queueJob(queued, job.limits!, "changed", { uploadETag: "tag", keyId: "key" })).rejects.toMatchObject({ code: "JOB_ALREADY_SUBMITTED" });
  });
  it("refuses a measured duration that exceeds remaining monthly minutes", async () => {
    send.mockImplementation(async command => command instanceof GetCommand && String(command.input.Key?.SK).startsWith("USAGE")
      ? { Item: { usedSeconds: 7190, reservedSeconds: 0 } } : { Item: { activeJobs: 1 } });
    await expect(reserveVerifiedUsage({ ...job, status: "STARTING", usageReserved: false }, 20)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(send.mock.calls.some(([command]) => command instanceof TransactWriteCommand)).toBe(false);
  });
});
