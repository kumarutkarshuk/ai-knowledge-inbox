import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../errors.js";
import type { ErrorResponse } from "../types/api.js";

function body(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

function clientError(err: unknown): HttpError | null {
  if (typeof err !== "object" || err === null) return null;
  if ("type" in err && err.type === "entity.too.large") {
    return new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  if ("type" in err && err.type === "entity.parse.failed") {
    return new HttpError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
  if ("status" in err && typeof err.status === "number" && err.status >= 400 && err.status < 500) {
    return new HttpError(err.status, "BAD_REQUEST", "Invalid request");
  }
  return null;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(body("NOT_FOUND", "Route not found"));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const known = err instanceof HttpError ? err : clientError(err);
  if (known) {
    res.status(known.status).json(body(known.code, known.message));
    return;
  }
  console.error(`${req.method} ${req.path} failed:`, err);
  res.status(500).json(body("INTERNAL_ERROR", "Something went wrong"));
};
