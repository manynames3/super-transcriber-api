import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { getCustomer } from "../shared/dynamodb.js";
import { errorResponse, jsonResponse } from "../shared/response.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event, { allowBillingBlocked: true });
    const customer = await getCustomer(auth.customerId);

    return jsonResponse(200, {
      customerId: auth.customerId,
      planId: customer?.planId ?? "unknown",
      billingStatus: customer?.billingStatus ?? "ACTIVE",
      limits: auth.limits,
      stripeCustomerId: customer?.stripeCustomerId ? customer.stripeCustomerId : undefined,
      requestId: event.requestContext.requestId
    });
  } catch (error) {
    return errorResponse(error);
  }
}
