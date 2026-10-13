import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { authenticate } from "../shared/auth.js";
import { client, customerPk, getJob, tableName } from "../shared/dynamodb.js";
import { badRequest, notFound } from "../shared/errors.js";
import { enqueueWebhookDelivery } from "../shared/queue.js";
import { errorResponse, jsonResponse } from "../shared/response.js";
import {
  decodeCursor,
  encodeCursor,
  parsePageLimit,
} from "../shared/validation.js";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const auth = await authenticate(event, { scope: "webhooks:manage" });
    const pk = customerPk(auth.customerId);
    if (event.requestContext.http.method === "GET") {
      const cursor = decodeCursor(event.queryStringParameters?.cursor);
      if (cursor && cursor.PK !== pk)
        throw badRequest("Invalid account cursor", "INVALID_CURSOR");
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: { ":pk": pk, ":prefix": "DELIVERY#" },
          Limit: parsePageLimit(event.queryStringParameters?.limit),
          ExclusiveStartKey: cursor,
        }),
      );
      return jsonResponse(200, {
        items: (result.Items ?? []).map(({ PK, SK, ...record }) => record),
        nextCursor: result.LastEvaluatedKey
          ? encodeCursor(result.LastEvaluatedKey)
          : null,
      });
    }
    const eventId = event.pathParameters?.eventId ?? "";
    const [jobId, eventType] = eventId.split(":");
    if (
      !jobId ||
      !["transcription.completed", "transcription.failed"].includes(eventType)
    )
      throw badRequest("Invalid event id");
    const record = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: pk, SK: `DELIVERY#${jobId}#${eventId}` },
      }),
    );
    const job = await getJob(auth.customerId, jobId);
    if (!record.Item || !job || job.deleted)
      throw notFound("Webhook delivery not found");
    await enqueueWebhookDelivery({
      customerId: auth.customerId,
      jobId,
      id: eventId,
      createdAt: job.updatedAt,
      eventType: eventType as
        "transcription.completed" | "transcription.failed",
    });
    return jsonResponse(202, { eventId, status: "QUEUED" });
  } catch (error) {
    return errorResponse(error);
  }
}
