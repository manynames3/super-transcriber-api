import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { getCustomer } from "../shared/dynamodb.js";
import { badRequest, notImplemented } from "../shared/errors.js";
import { isStripeConfigured } from "../shared/plans.js";
import { errorResponse, jsonResponse } from "../shared/response.js";
import { getStripeClient } from "../shared/stripe.js";
import { parseJsonBody, validateBillingPortalRequest } from "../shared/validation.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    if (!isStripeConfigured()) {
      throw notImplemented("Stripe billing portal is not configured for this deployment");
    }

    const auth = await authenticate(event, { allowBillingBlocked: true });
    const input = validateBillingPortalRequest(parseJsonBody(event.body));
    const customer = await getCustomer(auth.customerId);
    if (!customer?.stripeCustomerId) {
      throw badRequest("Authenticated customer does not have a Stripe billing account", "BILLING_ACCOUNT_NOT_FOUND");
    }

    const stripe = await getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: input.returnUrl
    });

    return jsonResponse(200, {
      portalUrl: session.url
    });
  } catch (error) {
    return errorResponse(error);
  }
}
