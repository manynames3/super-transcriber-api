import Stripe from "stripe";
import { internalError } from "./errors.js";
import { getSecretString } from "./secrets.js";

let cachedStripe: Stripe | undefined;

export async function getStripeClient(): Promise<Stripe> {
  if (cachedStripe) {
    return cachedStripe;
  }

  const secret = await getSecretString(process.env.STRIPE_SECRET_ARN);
  const apiKey = parseStripeSecret(secret, "secretKey");
  if (!apiKey) {
    throw internalError("Stripe is not configured");
  }

  cachedStripe = new Stripe(apiKey, {
    appInfo: {
      name: "super-transcriber-api",
      version: process.env.BUILD_VERSION ?? "local"
    }
  });
  return cachedStripe;
}

export async function getStripeWebhookSecret(): Promise<string> {
  const secret = await getSecretString(process.env.STRIPE_WEBHOOK_SECRET_ARN);
  const webhookSecret = parseStripeSecret(secret, "webhookSecret");
  if (!webhookSecret) {
    throw internalError("Stripe webhook secret is not configured");
  }
  return webhookSecret;
}

function parseStripeSecret(secret: string | null, key: "secretKey" | "webhookSecret"): string | null {
  if (!secret) {
    return null;
  }

  try {
    const parsed = JSON.parse(secret) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return secret;
  }
}
