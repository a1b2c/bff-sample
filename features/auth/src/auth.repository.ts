import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Auth data access. The only auth code that will talk to DynamoDB, through `_db`. */
export function createAuthRepository(_db: DynamoDBDocumentClient) {
  return {
    /** Sample method with no query behind it: real ones will read and write through `_db`. */
    ping(): 'ok' {
      return 'ok';
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
