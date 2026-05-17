import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { generateWebhookSigningSecret } from "../shared/crypto.js";
import { customerPk, getWebhook, nowIso, putWebhook, type WebhookRecord } from "../shared/dynamodb.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";
import { parseJsonBody, validateConfigureWebhookRequest } from "../shared/validation.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event);
    const input = validateConfigureWebhookRequest(parseJsonBody(event.body));
    const existing = await getWebhook(auth.customerId);
    const now = nowIso();
    const signingSecret = existing?.signingSecret ?? generateWebhookSigningSecret();

    const record: WebhookRecord = {
      PK: customerPk(auth.customerId),
      SK: "WEBHOOK#default",
      recordType: "WEBHOOK",
      customerId: auth.customerId,
      url: input.url,
      signingSecret,
      events: input.events,
      enabled: input.enabled,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await putWebhook(record);

    logInfo("webhook_configured", {
      requestId: event.requestContext.requestId,
      customerId: auth.customerId,
      route: "POST /v1/webhooks"
    });

    return jsonResponse(200, {
      url: record.url,
      events: record.events,
      enabled: record.enabled,
      signingSecret: existing ? undefined : signingSecret
    });
  } catch (error) {
    return errorResponse(error);
  }
}
