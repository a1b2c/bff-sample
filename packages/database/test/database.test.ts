import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databasePlugin, isConditionalCheckFailed } from '../src/index.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('databasePlugin', () => {
  it('exposes the client as app.db to the scope that registers it', async () => {
    const app = Fastify();
    let scoped: FastifyInstance | undefined;

    await app.register(async (feature) => {
      await feature.register(databasePlugin);
      scoped = feature;
    });

    expect(scoped?.db).toBeInstanceOf(DynamoDBDocumentClient);
    expect(app.hasDecorator('db')).toBe(false);
  });

  it('can be registered by more than one feature in the same app', async () => {
    const app = Fastify();

    for (const prefix of ['/auth', '/catalog']) {
      await app.register(
        async (feature) => {
          await feature.register(databasePlugin);
        },
        { prefix },
      );
    }

    await expect(app.ready()).resolves.toBeDefined();
  });

  it('closes the underlying client when the app closes', async () => {
    const destroy = vi.spyOn(DynamoDBClient.prototype, 'destroy');
    const app = Fastify();
    await app.register(databasePlugin);
    expect(destroy).not.toHaveBeenCalled();

    await app.close();

    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('isConditionalCheckFailed', () => {
  it('matches a failed condition', () => {
    const error = new ConditionalCheckFailedException({ message: 'failed', $metadata: {} });
    expect(isConditionalCheckFailed(error)).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isConditionalCheckFailed(new Error('boom'))).toBe(false);
    expect(isConditionalCheckFailed(undefined)).toBe(false);
  });
});
