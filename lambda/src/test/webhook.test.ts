import { beforeEach, expect, it, vi } from "vitest";
import type { SQSEvent } from "aws-lambda";
const mocks = vi.hoisted(() => ({ job: vi.fn(), hook: vi.fn(), post: vi.fn(), save: vi.fn() }));
vi.mock("../shared/dynamodb.js", () => ({ getJob: mocks.job, getWebhook: mocks.hook }));
vi.mock("../shared/webhook-http.js", () => ({ postWebhook: mocks.post }));
vi.mock("../shared/ledger.js", () => ({ saveDelivery: mocks.save }));
import { handler } from "../handlers/deliver-webhook.js";
import { job } from "./fixtures.js";
const event = { Records: [{ messageId: "message", body: JSON.stringify({ customerId: job.customerId, jobId: job.jobId, eventType: "transcription.completed", id: "stable", createdAt: job.updatedAt }) }] } as SQSEvent;
beforeEach(() => { vi.resetAllMocks(); mocks.job.mockResolvedValue({ ...job, status: "COMPLETED" }); mocks.hook.mockResolvedValue({ enabled: true, events: ["transcription.completed"], signingSecret: "test-signing-secret", url: "https://public.example/callback" }); });
it("retries with the same payload identity and records both attempts", async () => {
  mocks.post.mockResolvedValueOnce(503).mockResolvedValueOnce(200);
  expect(await handler(event)).toEqual({ batchItemFailures: [{ itemIdentifier: "message" }] });
  expect(await handler(event)).toEqual({ batchItemFailures: [] });
  expect(mocks.post.mock.calls[0][1]).toBe(mocks.post.mock.calls[1][1]);
  expect(JSON.parse(mocks.post.mock.calls[0][1]).id).toBe("stable");
  expect(mocks.save.mock.calls[0][3].status).toBe("FAILED"); expect(mocks.save.mock.calls[1][3].status).toBe("DELIVERED");
});
it("does not send callbacks for a hidden or purged job", async () => {
  mocks.job.mockResolvedValue({ ...job, deleted: true }); await handler(event); expect(mocks.post).not.toHaveBeenCalled();
});
