import awsLambdaFastify from '@fastify/aws-lambda';
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
 * Turns a feature into its Lambda handler: a Fastify app with Zod validation,
 * the shared error handling, and the feature's routes mounted at
 * `/{version}{prefix}` from its manifest.
 *
 * @example
 * import manifest from '../feature.json' with { type: 'json' };
 * import { authPlugin } from './auth.plugin.ts';
 * export const handler = await createFeatureHandler({ manifest, plugin: authPlugin });
 */
export async function createFeatureHandler(
  feature: FeatureApi,
  options: FastifyServerOptions = { logger: true },
) {
  // A JSON import is only loosely typed, so validate it here too: a bad manifest fails the cold start
  const manifest = parseManifest(feature.manifest);

  const app = Fastify(options).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);

  await app.register(feature.plugin, { prefix: publicPath(manifest) });

  const handler = awsLambdaFastify(app);
  // Finish plugin loading during the cold start, not on the first request
  await app.ready();
  return handler;
}
