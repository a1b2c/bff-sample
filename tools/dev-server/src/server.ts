import authManifest from '@feature/auth/feature.json' with { type: 'json' };
import { authPlugin } from '@feature/auth/plugin';
import catalogManifest from '@feature/catalog/feature.json' with { type: 'json' };
import { catalogPlugin } from '@feature/catalog/plugin';
import { buildApp } from '@repo/fastify-core';

const PORT = Number(process.env.PORT ?? 4000);

/** Serves every feature from one local process, instead of one Lambda each. */
const app = await buildApp([
  { manifest: authManifest, plugin: authPlugin },
  { manifest: catalogManifest, plugin: catalogPlugin },
]);

await app.listen({ port: PORT });
