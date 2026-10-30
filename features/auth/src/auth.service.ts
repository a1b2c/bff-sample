import type { z } from 'zod';
import type { PingResponse } from './auth.schema.ts';

/**
 * Auth business logic, kept free of Fastify so it can be tested on its own.
 * Dependencies (e.g. the database client) will be passed in here.
 */
export function createAuthService() {
  return {
    ping(): z.infer<typeof PingResponse> {
      return { status: 'ok', feature: 'auth' };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
