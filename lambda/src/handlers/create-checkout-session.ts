import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { putBillingSession, type BillingSessionRecord } from "../shared/dynamodb.js";
import { notImplemented } from "../shared/errors.js";
import { getPlan, getStripePriceId, isStripeConfigured } from "../shared/plans.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";
import { getStripeClient } from "../shared/stripe.js";
import { nowIso } from "../shared/dynamodb.js";
import { parseJsonBody, validateCreateCheckoutRequest } from "../shared/validation.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    if (!isStripeConfigured()) {
      throw notImplemented("Stripe checkout is not configured for this deployment");
    }

    const input = validateCreateCheckoutRequest(parseJsonBody(event.body));
    const plan = getPlan(input.planId);
    const priceId = getStripePriceId(input.planId);
    const stripe = await getStripeClient();
    const claimToken = randomBytes(24).toString("base64url");
    const customerId = `cust_${randomBytes(8).toString("hex")}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const fallbackRedirectUrl = defaultRedirectUrl(event);
    const successUrl = appendCheckoutPlaceholders(input.successUrl ?? fallbackRedirectUrl, claimToken);
    const cancelUrl = input.cancelUrl ?? fallbackRedirectUrl;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: input.email,
      client_reference_id: claimToken,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      metadata: {
        claimToken,
        customerId,
        planId: plan.planId,
        email: input.email
      },
      subscription_data: {
        metadata: {
          claimToken,
          customerId,
          planId: plan.planId
        }
      }
    });

    const now = nowIso();
    const record: BillingSessionRecord = {
      PK: `BILLING_SESSION#${claimToken}`,
      SK: "METADATA",
      recordType: "BILLING_SESSION",
      claimToken,
      checkoutSessionId: session.id,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      customerId,
      email: input.email,
      planId: plan.planId,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
      expiresAt,
      ttlEpochSeconds: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    };
    await putBillingSession(record);

    logInfo("checkout_session_created", {
      requestId: event.requestContext.requestId,
      checkoutSessionId: session.id,
      planId: plan.planId
    });

    return jsonResponse(200, {
      checkoutUrl: session.url,
      checkoutSessionId: session.id,
      claimToken,
      expiresAt
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function appendCheckoutPlaceholders(successUrl: string, claimToken: string): string {
  const parsed = new URL(successUrl);
  parsed.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  parsed.searchParams.set("claim_token", claimToken);
  return parsed.toString();
}

function defaultRedirectUrl(event: APIGatewayProxyEventV2): string {
  const stage = event.requestContext.stage && event.requestContext.stage !== "$default" ? `/${event.requestContext.stage}` : "";
  return `https://${event.requestContext.domainName}${stage}/health`;
}
