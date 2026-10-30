import { databasePlugin } from '@repo/database';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createAuthRepository } from './auth.repository.ts';
import { PingResponse } from './auth.schema.ts';
import { createAuthService } from './auth.service.ts';

/** The auth feature's routes, mounted at `/v1/auth` from `feature.json`. */
export const authPlugin: FastifyPluginAsyncZod = async (app) => {
  await app.register(databasePlugin);

  const repository = createAuthRepository(app.db);
  const auth = createAuthService(repository);

  app.get('/ping', { schema: { response: { 200: PingResponse } } }, () => auth.ping());
};
