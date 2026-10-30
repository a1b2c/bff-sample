import { z } from 'zod';

/** Shape of every error response body. Use it in route `response` schemas, e.g. `404: ErrorResponse`. */
export const ErrorResponse = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/**
 * An error thrown on purpose by a feature. The shared error handler sends it to
 * the client as-is; anything else becomes a generic 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}
