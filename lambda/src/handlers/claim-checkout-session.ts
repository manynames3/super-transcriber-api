import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { API_SCOPES } from "../shared/auth.js";
import { generateApiKey, hashApiKey } from "../shared/crypto.js";
import {
  client,
  tableName,
  getCustomer,
  claimBillingSessionWithApiKey,
  customerPk,
  getBillingSession,
  markBillingSessionPaid,
  nowIso,
  type ApiKeyRecord,
  type CustomerRecord,
} from "../shared/dynamodb.js";
import { conflict, notFound, notImplemented } from "../shared/errors.js";
import {
  getPlan,
  getPlanIdForStripePriceId,
  isStripeConfigured,
} from "../shared/plans.js";
import { errorResponse, jsonResponse } from "../shared/response.js";
import { getStripeClient } from "../shared/stripe.js";
import {
  parseJsonBody,
  validateClaimCheckoutRequest,
} from "../shared/validation.js";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    if (!isStripeConfigured())
      throw notImplemented(
        "Stripe checkout is not configured for this deployment",
      );
    const input = validateClaimCheckoutRequest(parseJsonBody(event.body));
    let sessionRecord = await getBillingSession(input.claimToken);
    if (
      !sessionRecord ||
      sessionRecord.checkoutSessionId !== input.checkoutSessionId ||
      Date.parse(sessionRecord.expiresAt) <= Date.now()
    )
      throw notFound("Checkout receipt is invalid or expired");
    if (sessionRecord.status === "CLAIMED" && !input.recover)
      throw conflict(
        "Already claimed; use recover:true to replace the receipt's API key",
        "CHECKOUT_ALREADY_CLAIMED",
      );
    const stripe = await getStripeClient();
    const checkout = await stripe.checkout.sessions.retrieve(
      input.checkoutSessionId,
    );
    if (
      checkout.status !== "complete" ||
      !["paid", "no_payment_required"].includes(checkout.payment_status)
    )
      throw conflict("Checkout is not paid", "CHECKOUT_NOT_PAID");
    const subscriptionId = asId(checkout.subscription);
    if (!subscriptionId)
      throw conflict("Checkout has no subscription", "SUBSCRIPTION_REQUIRED");
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (!["active", "trialing"].includes(subscription.status))
      throw conflict("Subscription is not active", "SUBSCRIPTION_INACTIVE");
    const planId =
      getPlanIdForStripePriceId(subscription.items.data[0]?.price.id) ??
      sessionRecord.planId;
    const plan = getPlan(planId);
    if (sessionRecord.status !== "CLAIMED") {
      await markBillingSessionPaid({
        claimToken: input.claimToken,
        checkoutSessionId: input.checkoutSessionId,
        stripeCustomerId: asId(checkout.customer),
        stripeSubscriptionId: subscriptionId,
      });
      sessionRecord = (await getBillingSession(input.claimToken))!;
    }
    const generated = generateApiKey();
    const now = nowIso();
    const customer: CustomerRecord = {
      PK: customerPk(sessionRecord.customerId),
      SK: "METADATA",
      GSI1PK: `STRIPE_CUSTOMER#${asId(checkout.customer)}`,
      GSI1SK: sessionRecord.customerId,
      recordType: "CUSTOMER",
      customerId: sessionRecord.customerId,
      name: sessionRecord.email,
      email: sessionRecord.email,
      planId: plan.planId,
      billingStatus: subscription.status === "trialing" ? "TRIALING" : "ACTIVE",
      stripeCustomerId: asId(checkout.customer),
      stripeSubscriptionId: subscriptionId,
      createdAt: now,
      updatedAt: now,
    };
    const apiKey: ApiKeyRecord = {
      PK: customer.PK,
      SK: `APIKEY#${generated.keyId}`,
      GSI1PK: `APIKEY#${generated.keyId}`,
      GSI1SK: customer.customerId,
      recordType: "API_KEY",
      customerId: customer.customerId,
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      keyHash: hashApiKey(generated.apiKey),
      name: `${plan.name} API key`,
      status: "ACTIVE",
      scopes: API_SCOPES,
      createdAt: now,
      updatedAt: now,
    };
    if (sessionRecord.status === "CLAIMED") {
      if (
        !(await getCustomer(customer.customerId)) ||
        !sessionRecord.createdApiKeyId
      )
        throw notFound("Customer not found");
      await client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName,
                Key: { PK: sessionRecord.PK, SK: sessionRecord.SK },
                UpdateExpression:
                  "SET createdApiKeyId = :new, updatedAt = :now",
                ConditionExpression: "createdApiKeyId = :old",
                ExpressionAttributeValues: {
                  ":new": generated.keyId,
                  ":old": sessionRecord.createdApiKeyId,
                  ":now": now,
                },
              },
            },
            {
              Update: {
                TableName: tableName,
                Key: {
                  PK: customer.PK,
                  SK: `APIKEY#${sessionRecord.createdApiKeyId}`,
                },
                UpdateExpression: "SET #status = :disabled, updatedAt = :now",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: {
                  ":disabled": "DISABLED",
                  ":now": now,
                },
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: apiKey,
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ],
        }),
      );
    } else await claimBillingSessionWithApiKey(sessionRecord, customer, apiKey);
    return jsonResponse(201, {
      customerId: customer.customerId,
      planId: plan.planId,
      billingStatus: customer.billingStatus,
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      apiKey: generated.apiKey,
      scopes: API_SCOPES,
      createdAt: now,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException")
      return errorResponse(
        conflict("Receipt changed; retry with recover:true", "CLAIM_CONFLICT"),
      );
    return errorResponse(error);
  }
}
function asId(value: string | { id?: string } | null): string {
  return typeof value === "string" ? value : (value?.id ?? "");
}
