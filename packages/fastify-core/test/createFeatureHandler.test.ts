import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ConflictError,
  createFeatureHandler,
  type FeatureApi,
  NotFoundError,
} from '../src/index.ts';

const manifest = {
  name: 'demo',
  version: 'v1',
  prefix: '/demo',
  handler: 'src/demo.handler.ts',
};

const plugin: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get('/ping', () => ({ ok: true }));
  app.post(
    '/users',
    {
      schema: {
        body: z.object({ email: z.email() }),
        response: { 201: z.object({ email: z.string() }) },
      },
    },
    (request, reply) => {
      reply.code(201);
      return { email: request.body.email };
    },
  );
  app.get('/missing', () => {
    throw new NotFoundError('Product not found');
  });
  app.get('/conflict', () => {
    throw new ConflictError('Email taken', { field: 'email' });
  });
  app.get('/crash', () => {
    throw new Error('db password is hunter2');
  });
  done();
};

type Handler = Awaited<ReturnType<typeof createFeatureHandler>>;

/** Calls the handler with an API Gateway HTTP API (payload v2) event, as Lambda would. */
async function invoke(handler: Handler, method: string, path: string, body?: string) {
  const event = {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body,
    isBase64Encoded: false,
    requestContext: { http: { method, path, sourceIp: '127.0.0.1' } },
  };
  // The adapter doesn't read the Lambda context for these requests
  const response = await handler(event, {} as never);
  const json: unknown = JSON.parse(response.body);
  return { status: response.statusCode, body: json };
}

function createHandler(feature: Partial<FeatureApi> = {}) {
  return createFeatureHandler({ manifest, plugin, ...feature }, { logger: false });
}

describe('createFeatureHandler', () => {
  it('mounts routes at /{version}{prefix}', async () => {
    const handler = await createHandler();
    expect(await invoke(handler, 'GET', '/v1/demo/ping')).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it('does not serve routes without the version', async () => {
    const handler = await createHandler();
    expect(await invoke(handler, 'GET', '/demo/ping')).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Route GET /demo/ping not found' },
    });
  });

  it('validates and types the request body with Zod', async () => {
    const handler = await createHandler();
    const body = JSON.stringify({ email: 'a@b.co' });
    expect(await invoke(handler, 'POST', '/v1/demo/users', body)).toEqual({
      status: 201,
      body: { email: 'a@b.co' },
    });
  });

  it('rejects an invalid manifest', async () => {
    await expect(createHandler({ manifest: { ...manifest, prefix: 'demo' } })).rejects.toThrow(
      /Invalid feature\.json[\s\S]*at prefix/,
    );
  });

  it('fails when the plugin fails to register', async () => {
    const broken: FastifyPluginCallbackZod = (_app, _opts, done) => done(new Error('no db'));
    await expect(createHandler({ plugin: broken })).rejects.toThrow('no db');
  });
});

describe('error handling', () => {
  it('sends an AppError with its status, code, message and details', async () => {
    const handler = await createHandler();

    expect(await invoke(handler, 'GET', '/v1/demo/missing')).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Product not found' },
    });
    expect(await invoke(handler, 'GET', '/v1/demo/conflict')).toEqual({
      status: 409,
      body: { code: 'CONFLICT', message: 'Email taken', details: { field: 'email' } },
    });
  });

  it('turns a Zod validation failure into a 400 with field details', async () => {
    const handler = await createHandler();
    const body = JSON.stringify({ email: 'not-an-email' });

    expect(await invoke(handler, 'POST', '/v1/demo/users', body)).toEqual({
      status: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: [{ path: '/email', message: 'Invalid email address' }],
      },
    });
  });

  it("passes Fastify's own client errors through", async () => {
    const handler = await createHandler();
    const { status, body } = await invoke(handler, 'POST', '/v1/demo/users', '{not json');

    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'FST_ERR_CTP_INVALID_JSON_BODY' });
  });

  it('hides unexpected errors behind a 500 and logs them', async () => {
    const logs: string[] = [];
    const handler = await createFeatureHandler(
      { manifest, plugin },
      { logger: { level: 'error', stream: { write: (line: string) => logs.push(line) } } },
    );

    expect(await invoke(handler, 'GET', '/v1/demo/crash')).toEqual({
      status: 500,
      body: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
    });
    expect(logs.join('')).toContain('db password is hunter2');
  });
});
