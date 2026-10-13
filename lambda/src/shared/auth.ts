import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  client,
  tableName,
  findApiKeyById,
  getCustomer,
  type ApiKeyRecord,
  type CustomerRecord,
} from "./dynamodb.js";
import { forbidden, internalError, unauthorized } from "./errors.js";
import { hashApiKey, parseApiKey, safeCompareHex } from "./crypto.js";
import {
  getLimitConfigFromEnv,
  mergeLimitConfig,
  type LimitConfig,
} from "./validation.js";
import { getAdminToken } from "./secrets.js";
import { getPlan } from "./plans.js";
import { consumeRequest } from "./ledger.js";

export const API_SCOPES = [
  "uploads:write",
  "transcriptions:write",
  "transcriptions:read",
  "transcriptions:delete",
  "keys:manage",
  "billing:read",
  "billing:write",
  "webhooks:manage",
];

export interface AuthContext {
  customerId: string;
  keyId: string;
  limits: LimitConfig;
  scopes: string[];
}

export function extractApiKeyFromHeaders(
  headers: APIGatewayProxyEventV2["headers"],
): string | null {
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

export async function authenticate(
  event: APIGatewayProxyEventV2,
  options: { allowBillingBlocked?: boolean; scope?: string } = {},
): Promise<AuthContext> {
  const apiKey = extractApiKeyFromHeaders(event.headers);
  if (!apiKey) {
    throw unauthorized();
  }

  const parsed = parseApiKey(apiKey);
  if (!parsed) {
    throw unauthorized();
  }

  const located = await findApiKeyById(parsed.keyId);
  const item = located
    ? await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: located.PK, SK: located.SK },
          ConsistentRead: true,
        }),
      )
    : undefined;
  const apiKeyRecord = item?.Item as ApiKeyRecord | undefined;
  if (!apiKeyRecord || apiKeyRecord.status !== "ACTIVE") {
    throw unauthorized();
  }

  const candidateHash = hashApiKey(apiKey);
  if (!safeCompareHex(candidateHash, apiKeyRecord.keyHash)) {
    throw unauthorized();
  }

  const customer = await getCustomer(apiKeyRecord.customerId);
  if (!customer) throw unauthorized();
  if (
    !options.allowBillingBlocked &&
    customer?.billingStatus &&
    ["PAST_DUE", "CANCELED", "UNPAID"].includes(customer.billingStatus)
  ) {
    throw forbidden("Billing status does not allow API access");
  }

  const scopes = apiKeyRecord.scopes ?? API_SCOPES;
  const scope = options.scope ?? routeScope(event.routeKey ?? "");
  if (scope && !scopes.includes(scope))
    throw forbidden(`API key requires ${scope} permission`);
  await consumeRequest(apiKeyRecord.keyId);
  return {
    customerId: apiKeyRecord.customerId,
    keyId: apiKeyRecord.keyId,
    limits: effectiveLimits(customer, apiKeyRecord),
    scopes,
  };
}

export async function requireAdmin(
  event: APIGatewayProxyEventV2,
): Promise<void> {
  const adminToken = await getAdminToken();
  if (!adminToken) {
    throw internalError("Admin route is not configured");
  }

  const normalized = normalizeHeaders(event.headers);
  const provided =
    normalized["x-admin-token"] ??
    /^Bearer\s+(.+)$/i.exec(normalized.authorization ?? "")?.[1];
  if (
    !provided ||
    !safeCompareHex(hashApiKey(provided), hashApiKey(adminToken))
  ) {
    throw forbidden("Invalid admin token");
  }
}

export function effectiveLimits(
  customer: CustomerRecord,
  key: ApiKeyRecord,
): LimitConfig {
  if (
    customer.planId &&
    customer.planId !== "manual" &&
    customer.planId !== "unknown"
  )
    return getPlan(customer.planId).limits;
  return mergeLimitConfig(
    getLimitConfigFromEnv(),
    customer.limits ?? key.limits,
  );
}

function routeScope(route: string): string | undefined {
  if (route.includes("api-keys")) return "keys:manage";
  if (route.includes("billing"))
    return route.startsWith("GET") ? "billing:read" : "billing:write";
  if (route.includes("webhooks")) return "webhooks:manage";
  if (route.includes("uploads")) return "uploads:write";
  if (route.startsWith("DELETE")) return "transcriptions:delete";
  if (route.startsWith("POST")) return "transcriptions:write";
  return "transcriptions:read";
}

function normalizeHeaders(
  headers: APIGatewayProxyEventV2["headers"],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value ?? "",
    ]),
  );
}
