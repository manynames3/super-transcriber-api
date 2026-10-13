import { expect, it } from "vitest";
import { isPublicAddress, parseWebhookUrl } from "../shared/validation.js";
import { effectiveLimits } from "../shared/auth.js";
import type { ApiKeyRecord, CustomerRecord } from "../shared/dynamodb.js";

it("blocks private, loopback, link-local, and mapped IP destinations", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.1.2", "192.168.1.1", "169.254.169.254", "100.64.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1"]) expect(isPublicAddress(ip)).toBe(false);
  expect(isPublicAddress("8.8.8.8")).toBe(true); expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  expect(() => parseWebhookUrl("https://169.254.169.254/latest/meta-data")).toThrow();
  expect(() => parseWebhookUrl("https://user:password@example.com")).toThrow();
  expect(() => parseWebhookUrl("http://localhost:3000")).toThrow();
});
it("subscription plan changes apply to existing keys immediately", () => {
  const customer = { planId: "team" } as CustomerRecord;
  const key = { limits: { monthlyTranscriptionMinutes: 120 } } as ApiKeyRecord;
  expect(effectiveLimits(customer, key).monthlyTranscriptionMinutes).toBe(1500);
  customer.planId = "starter"; expect(effectiveLimits(customer, key).monthlyTranscriptionMinutes).toBe(120);
});
