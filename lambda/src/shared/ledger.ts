import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  client,
  customerPk,
  getJob,
  jobSk,
  nowIso,
  tableName,
  type JobRecord,
} from "./dynamodb.js";
import { conflict, quotaExceeded } from "./errors.js";
import { monthKey, type LimitConfig } from "./validation.js";

export interface OutboxRecord {
  PK: string;
  SK: "EVENT";
  GSI1PK?: string;
  GSI1SK?: string;
  recordType: "OUTBOX";
  id: string;
  kind: "start" | "webhook" | "enrichment";
  customerId: string;
  jobId: string;
  eventType?: "transcription.completed" | "transcription.failed";
  status: "PENDING" | "DISPATCHED";
  createdAt: string;
  ttlEpochSeconds?: number;
}

export interface Usage {
  usageMonth: string;
  activeJobs: number;
  reservedSeconds: number;
  usedSeconds: number;
  completedJobs: number;
  failedJobs: number;
}

export function outboxRecord(
  job: JobRecord,
  kind: OutboxRecord["kind"],
  eventType?: OutboxRecord["eventType"],
): OutboxRecord {
  const id = `${job.jobId}:${eventType ?? kind}`;
  const createdAt = nowIso();
  return {
    PK: `OUTBOX#${id}`,
    SK: "EVENT",
    GSI1PK: "OUTBOX#PENDING",
    GSI1SK: `${createdAt}#${id}`,
    recordType: "OUTBOX",
    id,
    kind,
    customerId: job.customerId,
    jobId: job.jobId,
    eventType,
    status: "PENDING",
    createdAt,
  };
}

export async function queueJob(
  job: JobRecord,
  limits: LimitConfig,
  requestHash: string,
  fields: {
    speakerCount?: number;
    languageCode?: string;
    uploadETag: string;
    keyId: string;
  },
): Promise<JobRecord> {
  if (job.status !== "PENDING_UPLOAD") {
    if (job.requestHash === requestHash) return job;
    throw conflict(
      "This upload already has a different transcription request",
      "JOB_ALREADY_SUBMITTED",
    );
  }
  const now = nowIso();
  const queued: JobRecord = {
    ...job,
    status: "QUEUED",
    usageMonth: monthKey(),
    limits,
    requestHash,
    createdKeyId: fields.keyId,
    uploadETag: fields.uploadETag,
    speakerCount: fields.speakerCount ?? null,
    languageCode: fields.languageCode,
    processingS3Key: `customers/${job.customerId}/processing/${job.jobId}/${job.fileName}`,
    meteringVersion: 2,
    capacityReserved: true,
    usageReserved: false,
    updatedAt: now,
  };
  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: {
                ...queued,
                GSI1PK: "ACTIVE#JOBS",
                GSI1SK: `${now}#${job.jobId}`,
              },
              ConditionExpression: "#status = :pending AND deleted = :false",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":pending": "PENDING_UPLOAD",
                ":false": false,
              },
            },
          },
          {
            Update: {
              TableName: tableName,
              Key: { PK: customerPk(job.customerId), SK: "CAPACITY" },
              UpdateExpression: "SET updatedAt = :now ADD activeJobs :one",
              ConditionExpression:
                "attribute_not_exists(activeJobs) OR activeJobs < :limit",
              ExpressionAttributeValues: {
                ":now": now,
                ":one": 1,
                ":limit": limits.maxActiveJobs,
              },
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: outboxRecord(job, "start"),
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      }),
    );
    return queued;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "TransactionCanceledException"
    ) {
      const current = await getJob(job.customerId, job.jobId);
      if (current && !current.deleted && current.requestHash === requestHash)
        return current;
      if (current && current.status !== "PENDING_UPLOAD")
        throw conflict(
          "This upload already has a different transcription request",
          "JOB_ALREADY_SUBMITTED",
        );
      throw quotaExceeded(
        "Active job limit exceeded or upload is no longer available",
      );
    }
    throw error;
  }
}

export async function getUsage(
  customerId: string,
  usageMonth = monthKey(),
): Promise<Usage> {
  const [month, capacity] = await Promise.all([
    client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: customerPk(customerId), SK: `USAGE#${usageMonth}` },
        ConsistentRead: true,
      }),
    ),
    client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: customerPk(customerId), SK: "CAPACITY" },
        ConsistentRead: true,
      }),
    ),
  ]);
  return {
    usageMonth,
    activeJobs: Number(capacity.Item?.activeJobs ?? 0),
    reservedSeconds: Number(month.Item?.reservedSeconds ?? 0),
    usedSeconds: Number(month.Item?.usedSeconds ?? 0),
    completedJobs: Number(month.Item?.completedJobs ?? 0),
    failedJobs: Number(month.Item?.failedJobs ?? 0),
  };
}

export async function reserveVerifiedUsage(
  job: JobRecord,
  durationSeconds: number,
): Promise<JobRecord> {
  if (job.usageReserved) return job;
  const seconds = Math.ceil(durationSeconds);
  const usage = await getUsage(job.customerId, job.usageMonth);
  const limit = (job.limits?.monthlyTranscriptionMinutes ?? 120) * 60;
  const remaining = limit - usage.usedSeconds - seconds;
  if (remaining < 0)
    throw quotaExceeded("Monthly transcription minutes exhausted");
  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName,
              Key: { PK: job.PK, SK: job.SK },
              UpdateExpression:
                "SET durationSeconds = :duration, reservedDurationSeconds = :seconds, usageReserved = :true, updatedAt = :now",
              ConditionExpression:
                "#status = :starting AND (attribute_not_exists(usageReserved) OR usageReserved = :false)",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":duration": durationSeconds,
                ":seconds": seconds,
                ":true": true,
                ":false": false,
                ":starting": "STARTING",
                ":now": nowIso(),
              },
            },
          },
          {
            Update: {
              TableName: tableName,
              Key: { PK: job.PK, SK: `USAGE#${job.usageMonth}` },
              UpdateExpression:
                "SET usageMonth = :month, updatedAt = :now ADD reservedSeconds :seconds",
              ConditionExpression:
                "(attribute_not_exists(usedSeconds) OR usedSeconds = :used) AND (attribute_not_exists(reservedSeconds) OR reservedSeconds <= :remaining)",
              ExpressionAttributeValues: {
                ":month": job.usageMonth,
                ":now": nowIso(),
                ":seconds": seconds,
                ":used": usage.usedSeconds,
                ":remaining": remaining,
              },
            },
          },
        ],
      }),
    );
    return {
      ...job,
      durationSeconds,
      reservedDurationSeconds: seconds,
      usageReserved: true,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "TransactionCanceledException"
    ) {
      const current = await getJob(job.customerId, job.jobId);
      if (current?.usageReserved) return current;
      throw quotaExceeded(
        "Monthly transcription minutes exhausted; retry after capacity is released",
      );
    }
    throw error;
  }
}

export async function finishJob(
  job: JobRecord,
  status: "COMPLETED" | "FAILED",
  fields: {
    wordCount?: number;
    failureReason?: string;
    enrichment?: boolean;
  } = {},
): Promise<boolean> {
  const current = await getJob(job.customerId, job.jobId);
  if (!current || current.status === "COMPLETED" || current.status === "FAILED")
    return false;
  const eventType =
    status === "COMPLETED" ? "transcription.completed" : "transcription.failed";
  const items: NonNullable<
    ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
  > = [
    {
      Update: {
        TableName: tableName,
        Key: { PK: job.PK, SK: job.SK },
        UpdateExpression:
          "SET #status = :terminal, wordCount = :words, failureReason = :reason, updatedAt = :now REMOVE GSI1PK, GSI1SK",
        ConditionExpression:
          "attribute_exists(PK) AND #status <> :completed AND #status <> :failed",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":terminal": status,
          ":words": fields.wordCount ?? 0,
          ":reason": fields.failureReason ?? null,
          ":now": nowIso(),
          ":completed": "COMPLETED",
          ":failed": "FAILED",
        },
      },
    },
    {
      Put: {
        TableName: tableName,
        Item: outboxRecord(current, "webhook", eventType),
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
  ];
  if (current.capacityReserved)
    items.push({
      Update: {
        TableName: tableName,
        Key: { PK: job.PK, SK: "CAPACITY" },
        UpdateExpression: "ADD activeJobs :minusOne",
        ConditionExpression: "activeJobs >= :one",
        ExpressionAttributeValues: { ":minusOne": -1, ":one": 1 },
      },
    });
  if (current.usageReserved)
    items.push({
      Update: {
        TableName: tableName,
        Key: { PK: job.PK, SK: `USAGE#${current.usageMonth}` },
        UpdateExpression: `SET updatedAt = :now ADD reservedSeconds :refund, usedSeconds :used, ${status === "COMPLETED" ? "completedJobs" : "failedJobs"} :one`,
        ConditionExpression: "reservedSeconds >= :reserved",
        ExpressionAttributeValues: {
          ":now": nowIso(),
          ":refund": -current.reservedDurationSeconds,
          ":used": status === "COMPLETED" ? current.reservedDurationSeconds : 0,
          ":reserved": current.reservedDurationSeconds,
          ":one": 1,
        },
      },
    });
  else if (current.meteringVersion === 2)
    items.push({
      Update: {
        TableName: tableName,
        Key: { PK: job.PK, SK: `USAGE#${current.usageMonth}` },
        UpdateExpression: "SET updatedAt = :now ADD failedJobs :one",
        ExpressionAttributeValues: { ":now": nowIso(), ":one": 1 },
      },
    });
  if (status === "COMPLETED" && fields.enrichment)
    items.push({
      Put: {
        TableName: tableName,
        Item: outboxRecord(current, "enrichment"),
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });
  try {
    await client.send(new TransactWriteCommand({ TransactItems: items }));
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "TransactionCanceledException"
    ) {
      const latest = await getJob(job.customerId, job.jobId);
      if (latest?.status === "COMPLETED" || latest?.status === "FAILED")
        return false;
    }
    throw error;
  }
}

export async function getOutbox(id: string): Promise<OutboxRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `OUTBOX#${id}`, SK: "EVENT" },
      ConsistentRead: true,
    }),
  );
  return (result.Item as OutboxRecord | undefined) ?? null;
}

export async function markDispatched(id: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `OUTBOX#${id}`, SK: "EVENT" },
      UpdateExpression:
        "SET #status = :sent, ttlEpochSeconds = :ttl REMOVE GSI1PK, GSI1SK",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":sent": "DISPATCHED",
        ":ttl": Math.floor(Date.now() / 1000) + 7 * 86400,
      },
    }),
  );
}

export async function queryPending<T>(
  partition: "OUTBOX#PENDING" | "ACTIVE#JOBS",
  before: string,
): Promise<T[]> {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND GSI1SK < :before",
      ExpressionAttributeValues: { ":pk": partition, ":before": before },
      Limit: 100,
    }),
  );
  return (result.Items ?? []) as T[];
}

export async function saveDelivery(
  customerId: string,
  jobId: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: customerPk(customerId), SK: `DELIVERY#${jobId}#${id}` },
      UpdateExpression:
        "SET recordType = :type, eventId = :id, jobId = :job, #status = :status, lastError = :error, updatedAt = :now, ttlEpochSeconds = :ttl ADD attempts :one",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":type": "DELIVERY",
        ":id": id,
        ":job": jobId,
        ":status": fields.status,
        ":error": fields.error ?? null,
        ":now": nowIso(),
        ":ttl": Math.floor(Date.now() / 1000) + 30 * 86400,
        ":one": 1,
      },
    }),
  );
}

export async function consumeRequest(keyId: string): Promise<void> {
  const minute = Math.floor(Date.now() / 60000);
  const limit = Number(process.env.API_KEY_REQUESTS_PER_MINUTE ?? "120");
  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `KEYRATE#${keyId}`, SK: String(minute) },
        UpdateExpression: "SET ttlEpochSeconds = :ttl ADD requests :one",
        ConditionExpression:
          "attribute_not_exists(requests) OR requests < :limit",
        ExpressionAttributeValues: {
          ":ttl": minute * 60 + 120,
          ":one": 1,
          ":limit": limit,
        },
      }),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    )
      throw quotaExceeded("API request rate exceeded; retry next minute");
    throw error;
  }
}

export async function touchRecoveryCheck(job: JobRecord): Promise<void> {
  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: job.PK, SK: job.SK },
        UpdateExpression: "SET GSI1SK = :checked",
        ConditionExpression: "GSI1PK = :active",
        ExpressionAttributeValues: {
          ":checked": `${nowIso()}#${job.jobId}`,
          ":active": "ACTIVE#JOBS",
        },
      }),
    );
  } catch (error) {
    if (!(
      error instanceof Error && error.name === "ConditionalCheckFailedException"
    ))
      throw error;
  }
}
