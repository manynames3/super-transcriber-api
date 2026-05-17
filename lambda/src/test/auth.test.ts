import { describe, expect, it } from "vitest";
import { extractApiKeyFromHeaders } from "../shared/auth.js";
import { generateApiKey, hashApiKey, parseApiKey, safeCompareHex } from "../shared/crypto.js";

describe("api key handling", () => {
  it("extracts bearer and x-api-key headers", () => {
    const generated = generateApiKey();

    expect(extractApiKeyFromHeaders({ authorization: `Bearer ${generated.apiKey}` })).toBe(generated.apiKey);
    expect(extractApiKeyFromHeaders({ "x-api-key": generated.apiKey })).toBe(generated.apiKey);
  });

  it("parses generated keys and compares SHA-256 hashes", () => {
    const generated = generateApiKey();
    const parsed = parseApiKey(generated.apiKey);
    const hash = hashApiKey(generated.apiKey);

    expect(parsed?.keyId).toBe(generated.keyId);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(safeCompareHex(hash, hash)).toBe(true);
    expect(safeCompareHex(hash, "0".repeat(64))).toBe(false);
  });

  it("rejects malformed keys before lookup", () => {
    expect(parseApiKey("plain-text-key")).toBeNull();
  });
});
