import type { LimitConfig } from "./validation.js";
import { badRequest, internalError } from "./errors.js";

export interface BillingPlan {
  planId: string;
  name: string;
  limits: LimitConfig;
  enrichmentEnabled: boolean;
  webhookEnabled: boolean;
}

const defaultPlans: Record<string, BillingPlan> = {
  starter: {
    planId: "starter",
    name: "Starter",
    limits: {
      maxActiveJobs: 5,
      maxFileSizeBytes: 200 * 1024 * 1024,
      maxDurationSeconds: 20 * 60,
      monthlyTranscriptionMinutes: 120
    },
    enrichmentEnabled: false,
    webhookEnabled: true
  },
  team: {
    planId: "team",
    name: "Team",
    limits: {
      maxActiveJobs: 25,
      maxFileSizeBytes: 200 * 1024 * 1024,
      maxDurationSeconds: 60 * 60,
      monthlyTranscriptionMinutes: 1500
    },
    enrichmentEnabled: true,
    webhookEnabled: true
  }
};

export function getPlan(planId: string): BillingPlan {
  const configured = readConfiguredPlans();
  const plan = configured[planId] ?? defaultPlans[planId];
  if (!plan) {
    throw badRequest(`Unsupported billing plan: ${planId}`, "INVALID_PLAN");
  }
  return plan;
}

export function getStripePriceId(planId: string): string {
  const parsed = readStripePriceIds();
  if (Object.keys(parsed).length === 0) {
    throw internalError("Stripe price ids are not configured");
  }

  const priceId = parsed[planId];
  if (!priceId) {
    throw badRequest(`Stripe price id is not configured for plan ${planId}`, "INVALID_PLAN");
  }
  return priceId;
}

export function getPlanIdForStripePriceId(priceId: string | null | undefined): string | undefined {
  if (!priceId) {
    return undefined;
  }

  const parsed = readStripePriceIds();
  return Object.entries(parsed).find(([, configuredPriceId]) => configuredPriceId === priceId)?.[0];
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_ARN);
}

function readStripePriceIds(): Record<string, string> {
  const raw = process.env.STRIPE_PRICE_IDS_JSON;
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    throw internalError("Stripe price ids are not valid JSON");
  }
}

function readConfiguredPlans(): Record<string, BillingPlan> {
  const raw = process.env.BILLING_PLAN_LIMITS_JSON;
  if (!raw) {
    return defaultPlans;
  }

  const parsed = JSON.parse(raw) as Record<
    string,
    {
      name?: string;
      maxActiveJobs: number;
      maxFileSizeBytes: number;
      maxDurationSeconds: number;
      monthlyTranscriptionMinutes: number;
      enrichmentEnabled?: boolean;
      webhookEnabled?: boolean;
    }
  >;

  return Object.fromEntries(
    Object.entries(parsed).map(([planId, plan]) => [
      planId,
      {
        planId,
        name: plan.name ?? planId,
        limits: {
          maxActiveJobs: plan.maxActiveJobs,
          maxFileSizeBytes: plan.maxFileSizeBytes,
          maxDurationSeconds: plan.maxDurationSeconds,
          monthlyTranscriptionMinutes: plan.monthlyTranscriptionMinutes
        },
        enrichmentEnabled: plan.enrichmentEnabled ?? false,
        webhookEnabled: plan.webhookEnabled ?? true
      }
    ])
  );
}
