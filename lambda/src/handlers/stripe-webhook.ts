import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import Stripe from "stripe";
import { markBillingSessionPaid, updateCustomerBillingByStripeCustomer } from "../shared/dynamodb.js";
import { badRequest } from "../shared/errors.js";
import { getPlanIdForStripePriceId } from "../shared/plans.js";
import { jsonResponse, errorResponse, logInfo } from "../shared/response.js";
import { getStripeClient, getStripeWebhookSecret } from "../shared/stripe.js";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const stripe = await getStripeClient();
    const signature = event.headers["stripe-signature"] ?? event.headers["Stripe-Signature"];
    if (!signature) {
      throw badRequest("Missing Stripe signature", "MISSING_STRIPE_SIGNATURE");
    }

    const rawBody = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : event.body ?? "";
    const webhookSecret = await getStripeWebhookSecret();
    const stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    await handleStripeEvent(stripeEvent);

    return jsonResponse(200, { received: true });
  } catch (error) {
    if (error instanceof Error && error.name === "StripeSignatureVerificationError") return errorResponse(badRequest("Invalid Stripe signature", "INVALID_STRIPE_SIGNATURE"));
    return errorResponse(error);
  }
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const claimToken = session.metadata?.claimToken;
    if (!claimToken) {
      return;
    }
    await markBillingSessionPaid({
      claimToken,
      checkoutSessionId: session.id,
      stripeCustomerId: asId(session.customer),
      stripeSubscriptionId: asId(session.subscription)
    });
    logInfo("stripe_checkout_completed", {
      checkoutSessionId: session.id,
      planId: session.metadata?.planId
    });
    return;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const snapshot = event.data.object as Stripe.Subscription;
    const subscription = await (await getStripeClient()).subscriptions.retrieve(snapshot.id);
    const currentPriceId = subscription.items.data[0]?.price.id;
    await updateCustomerBillingByStripeCustomer({
      stripeCustomerId: asId(subscription.customer),
      billingStatus: mapSubscriptionStatus(subscription.status),
      planId: getPlanIdForStripePriceId(currentPriceId) ?? subscription.metadata.planId,
      stripeSubscriptionId: subscription.id,
      eventCreated: event.created
    });
    logInfo("stripe_subscription_status_updated", {
      stripeSubscriptionId: subscription.id,
      status: subscription.status
    });
  }
}

function mapSubscriptionStatus(status: Stripe.Subscription.Status): "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "UNPAID" {
  if (status === "active") {
    return "ACTIVE";
  }
  if (status === "trialing") {
    return "TRIALING";
  }
  if (status === "past_due") {
    return "PAST_DUE";
  }
  if (status === "canceled" || status === "incomplete_expired") {
    return "CANCELED";
  }
  return "UNPAID";
}

function asId(value: string | { id?: string } | null): string {
  if (!value) {
    return "";
  }
  return typeof value === "string" ? value : value.id ?? "";
}
