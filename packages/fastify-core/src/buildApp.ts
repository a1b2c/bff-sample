import { parseManifest, publicPath } from '@repo/feature-manifest';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerErrorHandlers } from './errorHandler.ts';
import type { FeatureApi } from './types.ts';

/**
 * A Fastify app with Zod validation, the shared error handling, and each
 * feature's routes mounted at `/{version}{prefix}` from its manifest. A Lambda
 * serves one feature; the local dev server serves them all.
 */
export async function buildApp(
  features: readonly FeatureApi[],
  options: FastifyServerOptions = { logger: true },
) {
  const app = Fastify(options).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);

  for (const feature of features) {
    // A JSON import is only loosely typed, so validate it here too: a bad manifest fails the cold start
    const manifest = parseManifest(feature.manifest);
    await app.register(feature.plugin, { prefix: publicPath(manifest) });
  }

  return app;
}
