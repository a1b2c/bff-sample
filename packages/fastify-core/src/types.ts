import type { FeatureManifest } from '@repo/feature-manifest';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

/**
 * A self-contained slice of the API (catalog, auth, ...) deployed as its own
 * Lambda. Its routes are mounted at `/{version}{prefix}` from the manifest.
 */
export interface FeatureApi {
  /** The feature's `feature.json`, imported with `with { type: 'json' }`. */
  readonly manifest: FeatureManifest;

  /**
   * Registers the feature's routes. Typed with the Zod provider, so `schema.body`
   * and `schema.response` are inferred from the Zod schemas. Call `done()` once
   * registration is finished.
   */
  readonly plugin: FastifyPluginCallbackZod;
}
