import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createHmac } from "node:crypto";

const apiKeyPattern = /^stapi_([a-f0-9]{18})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  apiKey: string;
  keyId: string;
  keyPrefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const keyId = randomBytes(9).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return {
    apiKey: `stapi_${keyId}_${secret}`,
    keyId,
    keyPrefix: `stapi_${keyId}`
  };
}

export function parseApiKey(apiKey: string): { keyId: string; keyPrefix: string } | null {
  const match = apiKeyPattern.exec(apiKey);
  if (!match) {
    return null;
  }

  return {
    keyId: match[1],
    keyPrefix: `stapi_${match[1]}`
  };
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

export function generateWebhookSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function signWebhookPayload(secret: string, payload: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
}

export function safeCompareHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
