import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

/**
 * A self-contained slice of the API (catalog, auth, ...) that can be mounted on
 * the shared Fastify instance.
 */
export interface FeatureApi {
  /**
   * Mount point for the feature's routes, e.g. '/cart'.
   * Must start with '/'; omit it for routes that live at the root.
   */
  readonly prefix?: string;

  /**
   * Registers the feature's routes. Typed with the Zod provider, so `schema.body`
   * and `schema.response` are inferred from the Zod schemas. Call `done()` once
   * registration is finished.
   */
  readonly plugin: FastifyPluginCallbackZod;
}
