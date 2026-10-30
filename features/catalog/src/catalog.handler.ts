import { createFeatureHandler } from '@repo/fastify-core';
import manifest from '../feature.json' with { type: 'json' };
import { catalogPlugin } from './catalog.plugin.ts';

export const handler = await createFeatureHandler({ manifest, plugin: catalogPlugin });
