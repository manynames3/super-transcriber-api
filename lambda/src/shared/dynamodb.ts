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

export type JobStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

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
  recordType: "CUSTOMER";
  customerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
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

export async function markJobCompleted(customerId: string, jobId: string, wordCount: number): Promise<void> {
  const updatedAt = nowIso();
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: customerPk(customerId),
        SK: jobSk(jobId)
      },
      UpdateExpression: "SET #status = :status, wordCount = :wordCount, failureReason = :failureReason, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "COMPLETED",
        ":wordCount": wordCount,
        ":failureReason": null,
        ":updatedAt": updatedAt
      }
    })
  );
}

export async function markJobFailed(customerId: string, jobId: string, failureReason: string): Promise<void> {
  const updatedAt = nowIso();
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: customerPk(customerId),
        SK: jobSk(jobId)
      },
      UpdateExpression: "SET #status = :status, failureReason = :failureReason, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "FAILED",
        ":failureReason": failureReason,
        ":updatedAt": updatedAt
      }
    })
  );
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
