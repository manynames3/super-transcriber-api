import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { generateApiKey, hashApiKey } from "../shared/crypto.js";
import {
  claimBillingSessionWithApiKey,
  customerPk,
  getBillingSession,
  markBillingSessionPaid,
  nowIso,
  type ApiKeyRecord,
  type CustomerRecord
} from "../shared/dynamodb.js";
import { conflict, notFound, notImplemented } from "../shared/errors.js";
import { getPlan, isStripeConfigured } from "../shared/plans.js";
import { errorResponse, jsonResponse, logInfo } from "../shared/response.js";
import { getStripeClient } from "../shared/stripe.js";
import { parseJsonBody, validateClaimCheckoutRequest } from "../shared/validation.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    if (!isStripeConfigured()) {
      throw notImplemented("Stripe checkout is not configured for this deployment");
    }

    const input = validateClaimCheckoutRequest(parseJsonBody(event.body));
    let sessionRecord = await getBillingSession(input.claimToken);
    if (!sessionRecord || sessionRecord.checkoutSessionId !== input.checkoutSessionId) {
      throw notFound("Checkout session not found");
    }
    if (sessionRecord.status === "CLAIMED") {
      throw conflict("Checkout session has already been claimed", "CHECKOUT_ALREADY_CLAIMED");
    }

    if (sessionRecord.status !== "PAID") {
      const stripe = await getStripeClient();
      const stripeSession = await stripe.checkout.sessions.retrieve(input.checkoutSessionId);
      if (stripeSession.status !== "complete" || (stripeSession.payment_status !== "paid" && stripeSession.payment_status !== "no_payment_required")) {
        throw conflict("Checkout session is not paid yet", "CHECKOUT_NOT_PAID");
      }
      await markBillingSessionPaid({
        claimToken: input.claimToken,
        checkoutSessionId: input.checkoutSessionId,
        stripeCustomerId: asId(stripeSession.customer),
        stripeSubscriptionId: asId(stripeSession.subscription)
      });
      sessionRecord = await getBillingSession(input.claimToken);
      if (!sessionRecord) {
        throw notFound("Checkout session not found");
      }
    }

    const plan = getPlan(sessionRecord.planId);
    const generated = generateApiKey();
    const now = nowIso();
    const customer: CustomerRecord = {
      PK: customerPk(sessionRecord.customerId),
      SK: "METADATA",
      GSI1PK: sessionRecord.stripeCustomerId ? `STRIPE_CUSTOMER#${sessionRecord.stripeCustomerId}` : undefined,
      GSI1SK: sessionRecord.customerId,
      recordType: "CUSTOMER",
      customerId: sessionRecord.customerId,
      name: sessionRecord.email,
      email: sessionRecord.email,
      planId: plan.planId,
      billingStatus: "ACTIVE",
      stripeCustomerId: sessionRecord.stripeCustomerId ?? undefined,
      stripeSubscriptionId: sessionRecord.stripeSubscriptionId ?? undefined,
      createdAt: now,
      updatedAt: now
    };
    const apiKey: ApiKeyRecord = {
      PK: customerPk(sessionRecord.customerId),
      SK: `APIKEY#${generated.keyId}`,
      GSI1PK: `APIKEY#${generated.keyId}`,
      GSI1SK: sessionRecord.customerId,
      recordType: "API_KEY",
      customerId: sessionRecord.customerId,
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      keyHash: hashApiKey(generated.apiKey),
      name: `${plan.name} API key`,
      status: "ACTIVE",
      limits: plan.limits,
      createdAt: now,
      updatedAt: now
    };

    await claimBillingSessionWithApiKey(sessionRecord, customer, apiKey);

    logInfo("checkout_session_claimed", {
      requestId: event.requestContext.requestId,
      customerId: sessionRecord.customerId,
      keyId: generated.keyId,
      planId: plan.planId
    });

    return jsonResponse(201, {
      customerId: sessionRecord.customerId,
      planId: plan.planId,
      billingStatus: "ACTIVE",
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      apiKey: generated.apiKey,
      createdAt: now
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function asId(value: string | { id?: string } | null): string {
  if (!value) {
    return "";
  }
  return typeof value === "string" ? value : value.id ?? "";
}
