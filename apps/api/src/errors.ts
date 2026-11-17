import { ERROR_CODES, type ApiError, type ErrorCode } from '@aki/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }

  override name = 'HttpError';
}

interface BodyParserError {
  type: string;
  status: number;
  expose: boolean;
  message: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as BodyParserError).type === 'string' &&
    typeof (err as BodyParserError).status === 'number'
  );
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (isBodyParserError(err)) {
    if (err.type === 'entity.too.large') {
      return new HttpError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body is too large');
    }
    if (err.type === 'entity.parse.failed') {
      return new HttpError(400, ERROR_CODES.INVALID_JSON, 'Request body is not valid JSON');
    }
    if (err.expose && err.status < 500) {
      return new HttpError(err.status, ERROR_CODES.VALIDATION_ERROR, err.message);
    }
  }
  return new HttpError(500, ERROR_CODES.INTERNAL_ERROR, 'Something went wrong');
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, ERROR_CODES.NOT_FOUND, 'Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const httpError = toHttpError(err);
  if (httpError.status >= 500) console.error(err);
  const body: ApiError = { error: { code: httpError.code, message: httpError.message } };
  res.status(httpError.status).json(body);
};
