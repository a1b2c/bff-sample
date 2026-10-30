import { createFeatureHandler } from '@repo/fastify-core';
import manifest from '../feature.json' with { type: 'json' };
import { authPlugin } from './auth.plugin.ts';

export const handler = await createFeatureHandler({ manifest, plugin: authPlugin });
