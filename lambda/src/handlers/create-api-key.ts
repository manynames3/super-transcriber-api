import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { requireAdmin } from "../shared/auth.js";
import { customerPk, createCustomerAndApiKey, nowIso, type ApiKeyRecord, type CustomerRecord } from "../shared/dynamodb.js";
import { badRequest, conflict } from "../shared/errors.js";
import { generateApiKey, hashApiKey } from "../shared/crypto.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";
import { getLimitConfigFromEnv, mergeLimitConfig, parseJsonBody, type LimitConfig } from "../shared/validation.js";

interface CreateApiKeyBody {
  customerId?: string;
  customerName?: string;
  keyName?: string;
  limits?: Partial<LimitConfig>;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    await requireAdmin(event);
    const body = event.body ? parseJsonBody<CreateApiKeyBody>(event.body) : {};
    const customerId = sanitizeCustomerId(body.customerId ?? `cust_${randomBytes(8).toString("hex")}`);
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
      createdAt: now,
      updatedAt: now
    };

    await createCustomerAndApiKey(customer, apiKey);

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
