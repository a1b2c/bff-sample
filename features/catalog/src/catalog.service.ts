import type { z } from 'zod';
import type { PingResponse } from './catalog.schema.ts';

/**
 * Catalog business logic, kept free of Fastify so it can be tested on its own.
 * Dependencies (e.g. the database client) will be passed in here.
 */
export function createCatalogService() {
  return {
    ping(): z.infer<typeof PingResponse> {
      return { status: 'ok', feature: 'catalog' };
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
