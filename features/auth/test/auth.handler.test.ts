import { describe, expect, it } from 'vitest';
import { handler } from '../src/auth.handler.ts';

/** Calls the real Lambda handler with an API Gateway HTTP API (payload v2) event. */
async function invoke(method: string, path: string) {
  const event = {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    requestContext: { http: { method, path, sourceIp: '127.0.0.1' } },
  };
  // The adapter doesn't read the Lambda context for these requests
  const response = await handler(event, {} as never);
  const json: unknown = JSON.parse(response.body);
  return { status: response.statusCode, body: json };
}

describe('auth handler', () => {
  it('answers GET /v1/auth/ping', async () => {
    expect(await invoke('GET', '/v1/auth/ping')).toEqual({
      status: 200,
      body: { status: 'ok', feature: 'auth' },
    });
  });

  it('returns 404 for unknown auth routes', async () => {
    expect(await invoke('GET', '/v1/auth/nope')).toMatchObject({
      status: 404,
      body: { code: 'NOT_FOUND' },
    });
  });
});
