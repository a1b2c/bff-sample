import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError, type ErrorResponse } from './errors.ts';

/**
 * Turns every error into an `ErrorResponse` body. Registered on the root
 * instance, so it applies to every feature unless one sets its own handler.
 */
export function registerErrorHandlers(app: FastifyInstance) {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // Thrown on purpose by a feature: safe to show the client as-is
    if (error instanceof AppError) {
      const body: ErrorResponse = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      return reply.code(error.statusCode).send(body);
    }

    // Request failed the route's Zod schema (body, querystring, params or headers)
    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ErrorResponse = {
        code: 'VALIDATION_ERROR',
        message: `Invalid request ${error.validationContext ?? 'input'}`,
        details: error.validation.map(({ instancePath, message }) => ({
          path: instancePath,
          message,
        })),
      };
      return reply.code(400).send(body);
    }

    // Fastify's own client errors: malformed JSON, unsupported media type, body too large, ...
    if (error.statusCode !== undefined && error.statusCode < 500) {
      const body: ErrorResponse = { code: error.code, message: error.message };
      return reply.code(error.statusCode).send(body);
    }

    // Anything else is a bug or a failed dependency: log the details, hide them from the client
    request.log.error({ err: error }, 'Unhandled error');
    const body: ErrorResponse = { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' };
    return reply.code(500).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ErrorResponse = {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    };
    return reply.code(404).send(body);
  });
}
