import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { PingResponse } from './auth.schema.ts';
import { createAuthService } from './auth.service.ts';

/** The auth feature's routes, mounted at `/v1/auth` from `feature.json`. */
export const authPlugin: FastifyPluginCallbackZod = (app, _opts, done) => {
  const auth = createAuthService();

  app.get('/ping', { schema: { response: { 200: PingResponse } } }, () => auth.ping());

  done();
};
