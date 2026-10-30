import fp from 'fastify-plugin';
import type { FastifyPluginAsyncZod, FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { buildApp, type FeatureApi } from '../src/index.ts';

function feature(name: string): FeatureApi {
  const plugin: FastifyPluginCallbackZod = (app, _opts, done) => {
    app.get('/ping', () => ({ feature: name }));
    done();
  };
  return {
    manifest: { name, version: 'v1', prefix: `/${name}`, handler: `src/${name}.handler.ts` },
    plugin,
  };
}

describe('buildApp', () => {
  it('mounts every feature at its own /{version}{prefix}', async () => {
    const app = await buildApp([feature('auth'), feature('catalog')], { logger: false });

    const auth = await app.inject({ method: 'GET', url: '/v1/auth/ping' });
    const catalog = await app.inject({ method: 'GET', url: '/v1/catalog/ping' });

    expect(auth.json()).toEqual({ feature: 'auth' });
    expect(catalog.json()).toEqual({ feature: 'catalog' });
  });

  it('waits for an async plugin to finish registering', async () => {
    const plugin: FastifyPluginAsyncZod = async (app) => {
      await app.register(
        fp((inner, _opts, done) => {
          inner.decorate('fromDependency', 'ready');
          done();
        }),
      );
      const value = app.getDecorator<string>('fromDependency');
      app.get('/ping', () => ({ value }));
    };

    const app = await buildApp([{ ...feature('auth'), plugin }], { logger: false });
    const response = await app.inject({ method: 'GET', url: '/v1/auth/ping' });

    expect(response.json()).toEqual({ value: 'ready' });
  });

  it('rejects an invalid manifest', async () => {
    const bad = { ...feature('auth'), manifest: { ...feature('auth').manifest, prefix: 'auth' } };
    await expect(buildApp([bad], { logger: false })).rejects.toThrow(/Invalid feature\.json/);
  });
});
