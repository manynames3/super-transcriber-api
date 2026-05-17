import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { notFound, quotaExceeded } from "./errors.js";
import type { LimitConfig } from "./validation.js";

export type JobStatus = "PENDING_UPLOAD" | "QUEUED" | "STARTING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface ApiKeyRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  recordType: "API_KEY";
  customerId: string;
  keyId: string;
  keyPrefix: string;
  keyHash: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  limits?: Partial<LimitConfig>;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerRecord {
  PK: string;
  SK: "METADATA";
  GSI1PK?: string;
  GSI1SK?: string;
  recordType: "CUSTOMER";
  customerId: string;
  name: string;
  email?: string;
  planId?: string;
  billingStatus?: "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "UNPAID" | "MANUAL";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillingSessionRecord {
  PK: string;
  SK: "METADATA";
  recordType: "BILLING_SESSION";
  claimToken: string;
  checkoutSessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  customerId: string;
  email: string;
  planId: string;
  status: "PENDING" | "PAID" | "CLAIMED" | "EXPIRED";
  createdApiKeyId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ttlEpochSeconds?: number;
}

export interface JobRecord {
  PK: string;
  SK: string;
  GSI2PK: string;
  GSI2SK: string;
  recordType: "JOB";
  jobId: string;
  customerId: string;
  status: JobStatus;
  s3Key: string;
  fileName: string;
  durationSeconds: number | null;
  speakerCount: number | null;
  reservedDurationSeconds: number;
  wordCount: number;
  failureReason: string | null;
  deleted: boolean;
  transcribeJobName: string;
  transcriptJsonS3Key: string;
  usageMonth: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookRecord {
  PK: string;
  SK: "WEBHOOK#default";
  recordType: "WEBHOOK";
  customerId: string;
  url: string;
  signingSecret: string;
  events: Array<"transcription.completed" | "transcription.failed">;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EnrichmentRecord {
  PK: string;
  SK: string;
  recordType: "ENRICHMENT";
  customerId: string;
  jobId: string;
  status: "COMPLETED" | "FAILED";
  s3Key: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscribeMappingRecord {
  PK: string;
  SK: "JOB";
  recordType: "TRANSCRIBE_JOB";
  customerId: string;
  jobId: string;
  transcribeJobName: string;
  createdAt: string;
  updatedAt: string;
}

const configuredTableName = process.env.TABLE_NAME;

if (!configuredTableName && process.env.NODE_ENV !== "test") {
  throw new Error("TABLE_NAME is required");
}

const tableName = configuredTableName ?? "test-table";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

export function nowIso(): string {
  return new Date().toISOString();
}

export function customerPk(customerId: string): string {
  return `CUSTOMER#${customerId}`;
}

export function jobSk(jobId: string): string {
  return `JOB#${jobId}`;
}

export async function findApiKeyById(keyId: string): Promise<ApiKeyRecord | null> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `APIKEY#${keyId}`
      },
      Limit: 1
    })
  );

  return (result.Items?.[0] as ApiKeyRecord | undefined) ?? null;
}

export async function createCustomerAndApiKey(customer: CustomerRecord, apiKey: ApiKeyRecord): Promise<void> {
  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: customer
          }
        },
        {
          Put: {
            TableName: tableName,
            Item: apiKey,
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
          }
        }
      ]
    })
  );
}

export async function getCustomer(customerId: string): Promise<CustomerRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: customerPk(customerId),
        SK: "METADATA"
      }
    })
  );

  return (result.Item as CustomerRecord | undefined) ?? null;
}

export async function putBillingSession(record: BillingSessionRecord): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: record,
      ConditionExpression: "attribute_not_exists(PK)"
    })
  );
}

export async function getBillingSession(claimToken: string): Promise<BillingSessionRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: `BILLING_SESSION#${claimToken}`,
        SK: "METADATA"
      }
    })
  );

  return (result.Item as BillingSessionRecord | undefined) ?? null;
}

export async function markBillingSessionPaid(fields: {
  claimToken: string;
  checkoutSessionId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
}): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: `BILLING_SESSION#${fields.claimToken}`,
        SK: "METADATA"
      },
      UpdateExpression:
        "SET #status = :paid, checkoutSessionId = :checkoutSessionId, stripeCustomerId = :stripeCustomerId, stripeSubscriptionId = :stripeSubscriptionId, updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(PK) AND (#status = :pending OR #status = :paid)",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":paid": "PAID",
        ":pending": "PENDING",
        ":checkoutSessionId": fields.checkoutSessionId,
        ":stripeCustomerId": fields.stripeCustomerId,
        ":stripeSubscriptionId": fields.stripeSubscriptionId,
        ":updatedAt": nowIso()
      }
    })
  );
}

export async function claimBillingSessionWithApiKey(
  session: BillingSessionRecord,
  customer: CustomerRecord,
  apiKey: ApiKeyRecord
): Promise<void> {
  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: tableName,
            Key: {
              PK: `BILLING_SESSION#${session.claimToken}`,
              SK: "METADATA"
            },
            UpdateExpression: "SET #status = :claimed, createdApiKeyId = :keyId, updatedAt = :updatedAt",
            ConditionExpression: "#status = :paid AND checkoutSessionId = :checkoutSessionId",
            ExpressionAttributeNames: {
              "#status": "status"
            },
            ExpressionAttributeValues: {
              ":claimed": "CLAIMED",
              ":paid": "PAID",
              ":checkoutSessionId": session.checkoutSessionId,
              ":keyId": apiKey.keyId,
              ":updatedAt": nowIso()
            }
          }
        },
        {
          Put: {
            TableName: tableName,
            Item: customer,
            ConditionExpression: "attribute_not_exists(PK)"
          }
        },
        {
          Put: {
            TableName: tableName,
            Item: apiKey,
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
          }
        }
      ]
    })
  );
}

export async function updateCustomerBillingByStripeCustomer(fields: {
  stripeCustomerId: string;
  billingStatus: CustomerRecord["billingStatus"];
  planId?: string;
  stripeSubscriptionId?: string | null;
}): Promise<void> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `STRIPE_CUSTOMER#${fields.stripeCustomerId}`
      },
      Limit: 1
    })
  );
  const customer = result.Items?.[0] as CustomerRecord | undefined;
  if (!customer) {
    return;
  }

  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: customer.PK,
        SK: "METADATA"
      },
      UpdateExpression:
        "SET billingStatus = :billingStatus, planId = :planId, stripeSubscriptionId = :stripeSubscriptionId, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":billingStatus": fields.billingStatus,
        ":planId": fields.planId ?? customer.planId ?? "unknown",
        ":stripeSubscriptionId": fields.stripeSubscriptionId ?? customer.stripeSubscriptionId ?? null,
        ":updatedAt": nowIso()
      }
    })
  );
}

export async function putJobAndMapping(job: JobRecord, mapping: TranscribeMappingRecord): Promise<void> {
  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: job,
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
          }
        },
        {
          Put: {
            TableName: tableName,
            Item: mapping,
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
          }
        }
      ]
    })
  );
}

export async function markJobQueued(
  customerId: string,
  jobId: string,
  fields: {
    durationSeconds: number | null;
    reservedDurationSeconds: number;
    speakerCount: number | null;
    usageMonth: string;
  }
): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: customerPk(customerId),
        SK: jobSk(jobId)
      },
      UpdateExpression:
        "SET #status = :queued, durationSeconds = :durationSeconds, reservedDurationSeconds = :reservedDurationSeconds, speakerCount = :speakerCount, usageMonth = :usageMonth, updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(PK) AND #status = :pending",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":queued": "QUEUED",
        ":pending": "PENDING_UPLOAD",
        ":durationSeconds": fields.durationSeconds,
        ":reservedDurationSeconds": fields.reservedDurationSeconds,
        ":speakerCount": fields.speakerCount,
        ":usageMonth": fields.usageMonth,
        ":updatedAt": nowIso()
      }
    })
  );
}

export async function getJob(customerId: string, jobId: string): Promise<JobRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: customerPk(customerId),
        SK: jobSk(jobId)
      }
    })
  );

  return (result.Item as JobRecord | undefined) ?? null;
}

export async function requireVisibleJob(customerId: string, jobId: string): Promise<JobRecord> {
  const job = await getJob(customerId, jobId);
  if (!job || job.deleted) {
    throw notFound("Transcription job not found");
  }
  return job;
}

export async function getTranscribeMapping(transcribeJobName: string): Promise<TranscribeMappingRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: `TRANSCRIBE#${transcribeJobName}`,
        SK: "JOB"
      }
    })
  );

  return (result.Item as TranscribeMappingRecord | undefined) ?? null;
}

export async function listJobs(
  customerId: string,
  limit: number,
  cursor?: Record<string, unknown>
): Promise<{ jobs: JobRecord[]; cursor?: Record<string, unknown> }> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      FilterExpression: "attribute_not_exists(deleted) OR deleted = :false",
      ExpressionAttributeValues: {
        ":pk": `JOBS#${customerId}`,
        ":false": false
      },
      ExclusiveStartKey: cursor,
      ScanIndexForward: false,
      Limit: limit
    })
  );

  return {
    jobs: (result.Items ?? []) as JobRecord[],
    cursor: result.LastEvaluatedKey
  };
}

export async function softDeleteJob(customerId: string, jobId: string): Promise<void> {
  const updatedAt = nowIso();
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: customerPk(customerId),
        SK: jobSk(jobId)
      },
      UpdateExpression: "SET deleted = :true, updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
      ExpressionAttributeValues: {
        ":true": true,
        ":updatedAt": updatedAt
      }
    })
  );
}

export async function markJobStarting(customerId: string, jobId: string): Promise<boolean> {
  const updatedAt = nowIso();
  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: customerPk(customerId),
          SK: jobSk(jobId)
        },
        UpdateExpression: "SET #status = :starting, updatedAt = :updatedAt",
        ConditionExpression: "attribute_exists(PK) AND (#status = :queued OR #status = :starting)",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":starting": "STARTING",
          ":queued": "QUEUED",
          ":updatedAt": updatedAt
        }
      })
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw error;
  }
}

export async function markJobInProgress(customerId: string, jobId: string): Promise<void> {
  const updatedAt = nowIso();
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: customerPk(customerId),
        SK: jobSk(jobId)
      },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(PK) AND (#status = :starting OR #status = :queued OR #status = :inProgress)",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "IN_PROGRESS",
        ":starting": "STARTING",
        ":queued": "QUEUED",
        ":inProgress": "IN_PROGRESS",
        ":updatedAt": updatedAt
      }
    })
  );
}

export async function markJobCompleted(customerId: string, jobId: string, wordCount: number): Promise<boolean> {
  const updatedAt = nowIso();
  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: customerPk(customerId),
          SK: jobSk(jobId)
        },
        UpdateExpression: "SET #status = :status, wordCount = :wordCount, failureReason = :failureReason, updatedAt = :updatedAt",
        ConditionExpression: "attribute_exists(PK) AND #status <> :completed AND #status <> :failed",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "COMPLETED",
          ":completed": "COMPLETED",
          ":failed": "FAILED",
          ":wordCount": wordCount,
          ":failureReason": null,
          ":updatedAt": updatedAt
        }
      })
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw error;
  }
}

export async function markJobFailed(customerId: string, jobId: string, failureReason: string): Promise<boolean> {
  const updatedAt = nowIso();
  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: customerPk(customerId),
          SK: jobSk(jobId)
        },
        UpdateExpression: "SET #status = :status, failureReason = :failureReason, updatedAt = :updatedAt",
        ConditionExpression: "attribute_exists(PK) AND #status <> :completed AND #status <> :failed",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "FAILED",
          ":completed": "COMPLETED",
          ":failed": "FAILED",
          ":failureReason": failureReason,
          ":updatedAt": updatedAt
        }
      })
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw error;
  }
}

export async function putWebhook(record: WebhookRecord): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: record
    })
  );
}

export async function getWebhook(customerId: string): Promise<WebhookRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: customerPk(customerId),
        SK: "WEBHOOK#default"
      }
    })
  );

  return (result.Item as WebhookRecord | undefined) ?? null;
}

export async function putEnrichmentRecord(record: EnrichmentRecord): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: record
    })
  );
}

export async function getEnrichmentRecord(customerId: string, jobId: string): Promise<EnrichmentRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: customerPk(customerId),
        SK: `ENRICHMENT#${jobId}`
      }
    })
  );

  return (result.Item as EnrichmentRecord | undefined) ?? null;
}

export async function reserveUsageCapacity(
  customerId: string,
  usageMonth: string,
  reservedSeconds: number,
  limits: LimitConfig
): Promise<void> {
  const monthlyLimitSeconds = limits.monthlyTranscriptionMinutes * 60;
  if (reservedSeconds > monthlyLimitSeconds) {
    throw quotaExceeded("Requested audio duration exceeds the monthly transcription limit");
  }

  const remainingAllowedSeconds = monthlyLimitSeconds - reservedSeconds;
  const now = nowIso();

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: customerPk(customerId),
          SK: `USAGE#${usageMonth}`
        },
        UpdateExpression:
          "SET recordType = :recordType, customerId = :customerId, usageMonth = :usageMonth, createdAt = if_not_exists(createdAt, :now), updatedAt = :now ADD activeJobs :one, submittedJobs :one, reservedSeconds :reservedSeconds",
        ConditionExpression:
          "(attribute_not_exists(activeJobs) OR activeJobs < :maxActiveJobs) AND (attribute_not_exists(reservedSeconds) OR reservedSeconds <= :remainingAllowedSeconds)",
        ExpressionAttributeValues: {
          ":recordType": "USAGE",
          ":customerId": customerId,
          ":usageMonth": usageMonth,
          ":now": now,
          ":one": 1,
          ":reservedSeconds": reservedSeconds,
          ":maxActiveJobs": limits.maxActiveJobs,
          ":remainingAllowedSeconds": remainingAllowedSeconds
        }
      })
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw quotaExceeded("Usage limit exceeded for active jobs or monthly transcription minutes");
    }
    throw error;
  }
}

export async function releaseUsageReservation(customerId: string, usageMonth: string, reservedSeconds: number): Promise<void> {
  await updateUsageCounter(customerId, usageMonth, -1, -reservedSeconds, "failedStarts");
}

export async function closeActiveUsage(customerId: string, usageMonth: string, completed: boolean): Promise<void> {
  await updateUsageCounter(customerId, usageMonth, -1, 0, completed ? "completedJobs" : "failedJobs");
}

async function updateUsageCounter(
  customerId: string,
  usageMonth: string,
  activeJobsDelta: number,
  reservedSecondsDelta: number,
  terminalCounter: "completedJobs" | "failedJobs" | "failedStarts"
): Promise<void> {
  const expressionValues: Record<string, string | number> = {
    ":now": nowIso(),
    ":activeDelta": activeJobsDelta,
    ":terminalDelta": 1,
    ":zero": 0
  };

  let updateExpression = `SET updatedAt = :now ADD activeJobs :activeDelta, ${terminalCounter} :terminalDelta`;
  if (reservedSecondsDelta !== 0) {
    updateExpression += ", reservedSeconds :reservedSecondsDelta";
    expressionValues[":reservedSecondsDelta"] = reservedSecondsDelta;
  }

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: customerPk(customerId),
          SK: `USAGE#${usageMonth}`
        },
        UpdateExpression: updateExpression,
        ConditionExpression: "attribute_exists(PK) AND activeJobs > :zero",
        ExpressionAttributeValues: expressionValues
      })
    );
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) {
      throw error;
    }
  }
}
