import { describe, expect, it } from 'vitest';
import { createAuthService } from '../src/auth.service.ts';

describe('auth service', () => {
  it('ping reports the auth feature as up', () => {
    const auth = createAuthService({ ping: () => 'ok' });
    expect(auth.ping()).toEqual({ status: 'ok', feature: 'auth' });
  });
});
