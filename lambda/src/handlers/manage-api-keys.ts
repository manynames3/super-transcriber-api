import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { API_SCOPES, authenticate } from "../shared/auth.js";
import {
  client,
  customerPk,
  nowIso,
  tableName,
  type ApiKeyRecord,
} from "../shared/dynamodb.js";
import { generateApiKey, hashApiKey } from "../shared/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../shared/errors.js";
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
    const auth = await authenticate(event, {
      allowBillingBlocked: true,
      scope: "keys:manage",
    });
    const pk = customerPk(auth.customerId);
    if (event.requestContext.http.method === "GET") {
      const cursor = decodeCursor(event.queryStringParameters?.cursor);
      if (cursor && cursor.PK !== pk)
        throw badRequest(
          "Cursor does not belong to this account",
          "INVALID_CURSOR",
        );
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: { ":pk": pk, ":prefix": "APIKEY#" },
          Limit: parsePageLimit(event.queryStringParameters?.limit),
          ExclusiveStartKey: cursor,
          ConsistentRead: true,
        }),
      );
      return jsonResponse(200, {
        items: (result.Items ?? []).map((key) => ({
          keyId: key.keyId,
          keyPrefix: key.keyPrefix,
          name: key.name,
          status: key.status,
          scopes: key.scopes ?? API_SCOPES,
          createdAt: key.createdAt,
        })),
        nextCursor: result.LastEvaluatedKey
          ? encodeCursor(result.LastEvaluatedKey)
          : null,
      });
    }
    const id = event.pathParameters?.keyId;
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id))
      throw badRequest("keyId is required", "INVALID_KEY_ID");
    const key = { PK: pk, SK: `APIKEY#${id}` };
    const result = await client.send(
      new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }),
    );
    const old = result.Item as ApiKeyRecord | undefined;
    if (!old) throw notFound("API key not found");
    if (event.requestContext.http.method === "DELETE") {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: key,
          UpdateExpression: "SET #status = :disabled, updatedAt = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":disabled": "DISABLED",
            ":now": nowIso(),
          },
        }),
      );
      return jsonResponse(200, { keyId: id, status: "DISABLED" });
    }
    const generated = generateApiKey();
    if (
      (old.scopes ?? API_SCOPES).some((scope) => !auth.scopes.includes(scope))
    )
      throw forbidden(
        "Cannot rotate a key with permissions outside your own key",
      );
    const now = nowIso();
    const replacement: ApiKeyRecord = {
      ...old,
      SK: `APIKEY#${generated.keyId}`,
      GSI1PK: `APIKEY#${generated.keyId}`,
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      keyHash: hashApiKey(generated.apiKey),
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName,
              Key: key,
              UpdateExpression: "SET #status = :disabled, updatedAt = :now",
              ConditionExpression: "#status = :active",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":disabled": "DISABLED",
                ":active": "ACTIVE",
                ":now": now,
              },
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: replacement,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      }),
    );
    return jsonResponse(201, {
      keyId: generated.keyId,
      keyPrefix: generated.keyPrefix,
      apiKey: generated.apiKey,
      scopes: replacement.scopes ?? auth.scopes,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException")
      return errorResponse(
        conflict("Key is already revoked or changed", "KEY_NOT_ACTIVE"),
      );
    return errorResponse(error);
  }
}
