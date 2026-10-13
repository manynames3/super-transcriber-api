import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { API_SCOPES, authenticate, extractApiKeyFromHeaders, requireAdmin } from "../shared/auth.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { client, tableName, getCustomer, customerPk, createCustomerAndApiKey, nowIso, type ApiKeyRecord, type CustomerRecord } from "../shared/dynamodb.js";
import { badRequest, conflict } from "../shared/errors.js";
import { generateApiKey, hashApiKey, parseApiKey } from "../shared/crypto.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";
import { getLimitConfigFromEnv, mergeLimitConfig, parseJsonBody, type LimitConfig } from "../shared/validation.js";

interface CreateApiKeyBody {
  customerId?: string;
  customerName?: string;
  keyName?: string;
  limits?: Partial<LimitConfig>;
  scopes?: string[];
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = parseApiKey(extractApiKeyFromHeaders(event.headers) ?? "") ? await authenticate(event, { allowBillingBlocked: true, scope: "keys:manage" }) : undefined;
    if (!auth) await requireAdmin(event);
    const body = event.body ? parseJsonBody<CreateApiKeyBody>(event.body) : {};
    for (const value of [body.customerId, body.customerName, body.keyName]) if (value !== undefined && typeof value !== "string") throw badRequest("Key/account names must be strings");
    if (body.limits && (typeof body.limits !== "object" || Array.isArray(body.limits))) throw badRequest("limits must be an object", "INVALID_LIMITS");
    const customerId = auth?.customerId ?? sanitizeCustomerId(body.customerId ?? `cust_${randomBytes(8).toString("hex")}`);
    if (auth && (body.limits || (body.customerId && body.customerId !== customerId))) throw badRequest("Customer keys cannot change account limits or ownership");
    const scopes = body.scopes ?? auth?.scopes ?? API_SCOPES;
    if (!Array.isArray(scopes) || !scopes.length || scopes.some(scope => !API_SCOPES.includes(scope) || (auth && !auth.scopes.includes(scope)))) throw badRequest("Invalid API-key scopes", "INVALID_SCOPES");
    const customerName = body.customerName?.trim() || customerId;
    const keyName = body.keyName?.trim() || "Default API key";
    const generated = generateApiKey();
    const now = nowIso();
    const limits = mergeLimitConfig(getLimitConfigFromEnv(), body.limits);

    const customer: CustomerRecord = {
      PK: customerPk(customerId),
      SK: "METADATA",
      recordType: "CUSTOMER",
      customerId,
      name: customerName,
      planId: "manual",
      billingStatus: "MANUAL",
      limits,
      createdAt: now,
      updatedAt: now
    };

    const apiKey: ApiKeyRecord = {
      PK: customerPk(customerId),
      SK: `APIKEY#${generated.keyId}`,
      GSI1PK: `APIKEY#${generated.keyId}`,
      GSI1SK: customerId,
      recordType: "API_KEY",
      customerId,
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      keyHash: hashApiKey(generated.apiKey),
      name: keyName,
      status: "ACTIVE",
      limits,
      scopes,
      createdAt: now,
      updatedAt: now
    };

    if (await getCustomer(customerId)) {
      await client.send(new PutCommand({ TableName: tableName, Item: apiKey, ConditionExpression: "attribute_not_exists(PK)" }));
    } else await createCustomerAndApiKey(customer, apiKey);

    logInfo("api_key_created", {
      requestId: event.requestContext.requestId,
      route: "POST /v1/api-keys",
      customerId,
      keyId: generated.keyId
    });

    return jsonResponse(201, {
      customerId,
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      apiKey: generated.apiKey,
      scopes,
      createdAt: now
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException") {
      return errorResponse(conflict("Customer or API key already exists"));
    }
    return errorResponse(error);
  }
}

function sanitizeCustomerId(customerId: string): string {
  const trimmed = customerId.trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(trimmed)) {
    throw badRequest("customerId must be 3-64 characters using letters, numbers, underscore, or hyphen", "INVALID_CUSTOMER_ID");
  }
  return trimmed;
}
