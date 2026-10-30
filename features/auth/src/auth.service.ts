import type { z } from 'zod';
import type { AuthRepository } from './auth.repository.ts';
import type { PingResponse } from './auth.schema.ts';

/**
 * Auth business logic, kept free of Fastify so it can be tested on its own.
 * It reaches the database only through the repository passed in here.
 */
export function createAuthService(repository: AuthRepository) {
  return {
    ping(): z.infer<typeof PingResponse> {
      return { status: repository.ping(), feature: 'auth' };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
