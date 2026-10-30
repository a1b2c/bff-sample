import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerErrorHandlers } from './errorHandler.ts';

/** The flavour of Fastify instance every app in the monorepo gets. */
export type AppInstance = ReturnType<typeof createFastify>;

/**
 * Creates a Fastify instance wired with Zod validation and serialization.
 * Callers add their own plugins and routes before calling `app.listen()`.
 */
export function createFastify(options: FastifyServerOptions = { logger: true }) {
  const app = Fastify(options).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);

  return app;
}
