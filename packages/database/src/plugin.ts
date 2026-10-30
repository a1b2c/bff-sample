import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import fp from 'fastify-plugin';
import { createDatabaseClient } from './client.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Only set in a scope that registered `databasePlugin`. */
    db: DynamoDBDocumentClient;
  }
}

/**
 * Adds a DynamoDB client as `app.db`, kept for as long as the app lives: one per
 * Lambda execution environment, reused while warm. `fp` exposes it to the feature
 * that registers this plugin, and stops there: other features can't see it.
 *
 * @example
 * await app.register(databasePlugin);
 * const repository = createAuthRepository(app.db);
 */
export const databasePlugin = fp(
  (app, _opts, done) => {
    const { db, close } = createDatabaseClient();
    app.decorate('db', db);
    app.addHook('onClose', (_instance, closed) => {
      close();
      closed();
    });
    done();
  },
  { name: '@repo/database' },
);
