import { describe, expect, it } from 'vitest';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ErrorResponse,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../src/index.ts';

describe('error classes', () => {
  it.each([
    [BadRequestError, 400, 'BAD_REQUEST', 'Bad request'],
    [UnauthorizedError, 401, 'UNAUTHORIZED', 'Unauthorized'],
    [ForbiddenError, 403, 'FORBIDDEN', 'Forbidden'],
    [NotFoundError, 404, 'NOT_FOUND', 'Not found'],
    [ConflictError, 409, 'CONFLICT', 'Conflict'],
  ])('%o has status %i, code %s and a default message', (ErrorClass, statusCode, code, message) => {
    const error = new ErrorClass();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ statusCode, code, message, name: ErrorClass.name });
  });

  it('keeps a custom message and details', () => {
    const error = new ConflictError('Email taken', { field: 'email' });
    expect(error).toMatchObject({ message: 'Email taken', details: { field: 'email' } });
  });

  it('lets features define their own errors', () => {
    const error = new AppError(429, 'RATE_LIMITED', 'Slow down');
    expect(error).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED', name: 'AppError' });
  });
});

describe('ErrorResponse', () => {
  it('accepts a body with or without details', () => {
    expect(ErrorResponse.safeParse({ code: 'X', message: 'y' }).success).toBe(true);
    expect(ErrorResponse.safeParse({ code: 'X', message: 'y', details: [1] }).success).toBe(true);
  });

  it('rejects a body without a code', () => {
    expect(ErrorResponse.safeParse({ message: 'y' }).success).toBe(false);
  });
});
