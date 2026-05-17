import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { findApiKeyById } from "./dynamodb.js";
import { forbidden, internalError, unauthorized } from "./errors.js";
import { hashApiKey, parseApiKey, safeCompareHex } from "./crypto.js";
import { getLimitConfigFromEnv, mergeLimitConfig, type LimitConfig } from "./validation.js";

export interface AuthContext {
  customerId: string;
  keyId: string;
  limits: LimitConfig;
}

export function extractApiKeyFromHeaders(headers: APIGatewayProxyEventV2["headers"]): string | null {
  const normalized = normalizeHeaders(headers);
  const xApiKey = normalized["x-api-key"];
  if (xApiKey) {
    return xApiKey.trim();
  }

  const authorization = normalized.authorization;
  if (!authorization) {
    return null;
  }

  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  return bearerMatch?.[1]?.trim() ?? null;
}

export async function authenticate(event: APIGatewayProxyEventV2): Promise<AuthContext> {
  const apiKey = extractApiKeyFromHeaders(event.headers);
  if (!apiKey) {
    throw unauthorized();
  }

  const parsed = parseApiKey(apiKey);
  if (!parsed) {
    throw unauthorized();
  }

  const apiKeyRecord = await findApiKeyById(parsed.keyId);
  if (!apiKeyRecord || apiKeyRecord.status !== "ACTIVE") {
    throw unauthorized();
  }

  const candidateHash = hashApiKey(apiKey);
  if (!safeCompareHex(candidateHash, apiKeyRecord.keyHash)) {
    throw unauthorized();
  }

  return {
    customerId: apiKeyRecord.customerId,
    keyId: apiKeyRecord.keyId,
    limits: mergeLimitConfig(getLimitConfigFromEnv(), apiKeyRecord.limits)
  };
}

export function requireAdmin(event: APIGatewayProxyEventV2): void {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    throw internalError("Admin route is not configured");
  }

  const normalized = normalizeHeaders(event.headers);
  const provided = normalized["x-admin-token"] ?? /^Bearer\s+(.+)$/i.exec(normalized.authorization ?? "")?.[1];
  if (!provided || provided !== adminToken) {
    throw forbidden("Invalid admin token");
  }
}

function normalizeHeaders(headers: APIGatewayProxyEventV2["headers"]): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value ?? ""]));
}
