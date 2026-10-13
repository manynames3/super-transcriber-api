import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn<(command: unknown) => Promise<Record<string, unknown>>>() }));
vi.mock("@aws-sdk/lib-dynamodb", async original => ({ ...(await original<typeof import("@aws-sdk/lib-dynamodb")>()), DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) } }));
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { markJobStarting, markJobInProgress, updateCustomerBillingByStripeCustomer } from "../shared/dynamodb.js";

it("worker state expressions declare exactly their referenced values", async () => {
  mocks.send.mockImplementation(async command => {
    const input = (command as UpdateCommand).input;
    const used = new Set(`${input.UpdateExpression} ${input.ConditionExpression}`.match(/:[A-Za-z][A-Za-z0-9_]*/g));
    expect(new Set(Object.keys(input.ExpressionAttributeValues ?? {}))).toEqual(used);
    return {};
  });
  expect(await markJobStarting("customer", "job")).toBe(true);
  await markJobInProgress("customer", "job");
});

it("prevents older Stripe events from overwriting newer customer state", async () => {
  mocks.send.mockReset();
  mocks.send.mockResolvedValueOnce({ Items: [{ PK: "CUSTOMER#test", SK: "METADATA", planId: "team" }] });
  mocks.send.mockRejectedValueOnce(Object.assign(new Error("older event"), { name: "ConditionalCheckFailedException" }));
  await updateCustomerBillingByStripeCustomer({ stripeCustomerId: "cus_test", billingStatus: "PAST_DUE", eventCreated: 100 });
  const input = (mocks.send.mock.calls[1][0] as UpdateCommand).input;
  expect(input.ConditionExpression).toBe("attribute_not_exists(billingEventCreated) OR billingEventCreated <= :eventCreated");
  expect(input.ExpressionAttributeValues?.[":eventCreated"]).toBe(100);
});
