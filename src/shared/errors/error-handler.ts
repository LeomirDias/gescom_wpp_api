import type { ErrorRequestHandler } from "express";
import { AppError } from "./app-error";
import { createApiErrorResponse } from "./api-error-response";

type RequestWithOptionalId = {
  requestId?: string;
};

const INTERNAL_SERVER_ERROR_CODE = "INTERNAL_SERVER_ERROR";
const INTERNAL_SERVER_ERROR_MESSAGE = "Erro interno inesperado";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const request = req as RequestWithOptionalId;
  const requestId = request.requestId ?? null;

  if (err instanceof AppError) {
    res.status(err.statusCode).json(
      createApiErrorResponse({
        requestId,
        code: err.code,
        message: err.message,
        details: err.details,
      }),
    );
    return;
  }

  const unexpectedError = err instanceof Error ? err : new Error(String(err));

  console.error({
    event: "unexpected_error",
    requestId,
    code: INTERNAL_SERVER_ERROR_CODE,
    message: unexpectedError.message,
    stack: unexpectedError.stack,
  });

  res.status(500).json(
    createApiErrorResponse({
      requestId,
      code: INTERNAL_SERVER_ERROR_CODE,
      message: INTERNAL_SERVER_ERROR_MESSAGE,
    }),
  );
};
