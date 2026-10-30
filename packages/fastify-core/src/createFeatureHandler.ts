import awsLambdaFastify from '@fastify/aws-lambda';
import type { FastifyServerOptions } from 'fastify';
import { buildApp } from './buildApp.ts';
import type { FeatureApi } from './types.ts';

/**
 * Turns a feature into its Lambda handler: an app from `buildApp` serving just
 * that feature.
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
  const app = await buildApp([feature], options);

  const handler = awsLambdaFastify(app);
  // Finish plugin loading during the cold start, not on the first request
  await app.ready();
  return handler;
}
