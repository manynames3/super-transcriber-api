import type { DynamoDBStreamEvent, DynamoDBBatchResponse } from "aws-lambda";
import { getOutbox } from "../shared/ledger.js";
import { dispatchOutbox } from "../shared/outbox.js";
import { logError } from "../shared/response.js";

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures: DynamoDBBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    try {
      const pk = record.dynamodb?.Keys?.PK?.S;
      if (!pk?.startsWith("OUTBOX#")) continue;
      const outbox = await getOutbox(pk.slice("OUTBOX#".length));
      if (outbox) await dispatchOutbox(outbox);
    } catch (error) {
      logError("outbox_dispatch_failed", { error: error instanceof Error ? error.name : "UnknownError" });
      if (record.dynamodb?.SequenceNumber) batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
    }
  }
  return { batchItemFailures };
}
