import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { PingResponse } from './catalog.schema.ts';
import { createCatalogService } from './catalog.service.ts';

/** The catalog feature's routes, mounted at `/v1/catalog` from `feature.json`. */
export const catalogPlugin: FastifyPluginCallbackZod = (app, _opts, done) => {
  const catalog = createCatalogService();

  app.get('/ping', { schema: { response: { 200: PingResponse } } }, () => catalog.ping());

  done();
};
