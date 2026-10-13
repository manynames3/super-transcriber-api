import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { getCustomer } from "../shared/dynamodb.js";
import { getUsage } from "../shared/ledger.js";
import { errorResponse, jsonResponse } from "../shared/response.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event, { allowBillingBlocked: true });
    const customer = await getCustomer(auth.customerId);
    const usage = await getUsage(auth.customerId);

    return jsonResponse(200, {
      customerId: auth.customerId,
      planId: customer?.planId ?? "unknown",
      billingStatus: customer?.billingStatus ?? "ACTIVE",
      limits: auth.limits,
      usage: { ...usage, usedMinutes: usage.usedSeconds / 60, reservedMinutes: usage.reservedSeconds / 60,
        remainingMinutes: Math.max(0, auth.limits.monthlyTranscriptionMinutes - (usage.usedSeconds + usage.reservedSeconds) / 60) },
      stripeCustomerId: customer?.stripeCustomerId ? customer.stripeCustomerId : undefined,
      requestId: event.requestContext.requestId
    });
  } catch (error) {
    return errorResponse(error);
  }
}
