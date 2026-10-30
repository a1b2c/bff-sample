import { describe, expect, it } from 'vitest';
import { createAuthService } from '../src/auth.service.ts';

describe('auth service', () => {
  it('ping reports the auth feature as up', () => {
    expect(createAuthService().ping()).toEqual({ status: 'ok', feature: 'auth' });
  });
});
