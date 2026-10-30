import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

/** True when a write's `ConditionExpression` wasn't met, e.g. the item already exists. */
export function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException;
}
