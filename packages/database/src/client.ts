import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** A document client and how to close it: its own `destroy()` does nothing, only the base client's does. */
export function createDatabaseClient() {
  const base = new DynamoDBClient({
    endpoint: process.env.DB_ENDPOINT, // Only set locally. Region comes from AWS_REGION
    maxAttempts: 3,
    // The SDK has no request timeout by default: a stuck call would use up the Lambda's timeout
    requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000 },
  });
  const db = DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return { db, close: () => base.destroy() };
}
