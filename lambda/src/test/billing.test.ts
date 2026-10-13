import { beforeEach, expect, it, vi } from "vitest";
import { apiEvent } from "./fixtures.js";

const mocks = vi.hoisted(() => ({
  receipt: vi.fn(), customer: vi.fn(), claim: vi.fn(), paid: vi.fn(), send: vi.fn(),
  checkout: vi.fn(), subscription: vi.fn(), construct: vi.fn(), update: vi.fn()
}));
vi.mock("../shared/dynamodb.js", () => ({
  client: { send: mocks.send }, tableName: "test", getCustomer: mocks.customer,
  getBillingSession: mocks.receipt, claimBillingSessionWithApiKey: mocks.claim,
  markBillingSessionPaid: mocks.paid, updateCustomerBillingByStripeCustomer: mocks.update,
  customerPk: (id: string) => `CUSTOMER#${id}`, nowIso: () => new Date().toISOString()
}));
vi.mock("../shared/stripe.js", () => ({
  getStripeClient: async () => ({ checkout: { sessions: { retrieve: mocks.checkout } },
    subscriptions: { retrieve: mocks.subscription }, webhooks: { constructEvent: mocks.construct } }),
  getStripeWebhookSecret: async () => "test-secret"
}));
import { handler as claim } from "../handlers/claim-checkout-session.js";
import { handler as webhook } from "../handlers/stripe-webhook.js";

const receipt = { PK: "BILLING#receipt", SK: "SESSION", customerId: "customer", email: "test@example.com",
  planId: "starter", checkoutSessionId: "cs_test", status: "PAID", expiresAt: "2099-01-01T00:00:00Z" };
const claimEvent = (recover = false) => apiEvent("POST /v1/billing/claim", {
  body: JSON.stringify({ claimToken: "receipt", checkoutSessionId: "cs_test", recover })
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRIPE_SECRET_ARN", "test-reference");
  vi.stubEnv("STRIPE_PRICE_IDS_JSON", JSON.stringify({ starter: "price_starter", team: "price_team" }));
  mocks.receipt.mockResolvedValue(receipt);
  mocks.checkout.mockResolvedValue({ status: "complete", payment_status: "paid", subscription: "sub_test", customer: "cus_test" });
  mocks.subscription.mockResolvedValue({ id: "sub_test", status: "active", customer: "cus_test", metadata: { planId: "starter" }, items: { data: [{ price: { id: "price_team" } }] } });
});

it("rejects an expired receipt before contacting Stripe or creating a key", async () => {
  mocks.receipt.mockResolvedValue({ ...receipt, expiresAt: "2020-01-01T00:00:00Z" });
  expect((await claim(claimEvent())).statusCode).toBe(404);
  expect(mocks.checkout).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
});
it("refuses receipt recovery when the subscription is no longer active", async () => {
  mocks.receipt.mockResolvedValue({ ...receipt, status: "CLAIMED", createdApiKeyId: "old" });
  mocks.subscription.mockResolvedValue({ status: "canceled" });
  const result = await claim(claimEvent(true));
  expect(result.statusCode).toBe(409); expect(JSON.parse(result.body!).code).toBe("SUBSCRIPTION_INACTIVE");
  expect(mocks.send).not.toHaveBeenCalled();
});
it("rechecks payment rather than trusting a PAID receipt", async () => {
  mocks.checkout.mockResolvedValue({ status: "complete", payment_status: "unpaid" });
  expect((await claim(claimEvent())).statusCode).toBe(409);
  expect(mocks.subscription).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
});
it("uses the current paid price and stores only a hashed new key", async () => {
  const result = await claim(claimEvent());
  expect(result.statusCode).toBe(201);
  const [_, customer, key] = mocks.claim.mock.calls[0];
  expect(customer.planId).toBe("team"); expect(key.keyHash).toMatch(/^[a-f0-9]{64}$/);
  expect(key.apiKey).toBeUndefined(); expect(JSON.parse(result.body!).apiKey).toMatch(/^stapi_/);
});
it("recovers a receipt by atomically replacing its last issued key", async () => {
  mocks.receipt.mockResolvedValue({ ...receipt, status: "CLAIMED", createdApiKeyId: "old" });
  mocks.customer.mockResolvedValue({ customerId: "customer" });
  expect((await claim(claimEvent(true))).statusCode).toBe(201);
  const items = mocks.send.mock.calls[0][0].input.TransactItems;
  expect(items).toHaveLength(3);
  expect(items[0].Update.ConditionExpression).toBe("createdApiKeyId = :old");
  expect(items[1].Update.Key.SK).toBe("APIKEY#old");
  expect(items[1].Update.ExpressionAttributeValues[":disabled"]).toBe("DISABLED");
  expect(items[2].Put.Item.keyHash).toMatch(/^[a-f0-9]{64}$/);
});
it("retrieves current subscription state rather than trusting webhook snapshots", async () => {
  mocks.construct.mockReturnValue({ type: "customer.subscription.updated", created: 123,
    data: { object: { id: "sub_test", status: "past_due" } } });
  expect((await webhook(apiEvent("POST /v1/billing/webhook", { headers: { "stripe-signature": "test" }, body: "{}" }))).statusCode).toBe(200);
  expect(mocks.subscription).toHaveBeenCalledWith("sub_test");
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ billingStatus: "ACTIVE", planId: "team", eventCreated: 123 }));
});
it("returns a structured error for an invalid Stripe signature", async () => {
  mocks.construct.mockImplementation(() => { throw Object.assign(new Error("invalid signature"), { name: "StripeSignatureVerificationError" }); });
  const result = await webhook(apiEvent("POST /v1/billing/webhook", { headers: { "stripe-signature": "bad" }, body: "{}" }));
  expect(result.statusCode).toBe(400); expect(JSON.parse(result.body!).code).toBe("INVALID_STRIPE_SIGNATURE");
  expect(mocks.update).not.toHaveBeenCalled();
});
