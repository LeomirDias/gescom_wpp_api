import type { ApiErrorDetails } from "./api-error-response";

type AppErrorInput = {
  statusCode: number;
  code: string;
  message: string;
  details?: ApiErrorDetails;
};

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ApiErrorDetails;

  public constructor({ statusCode, code, message, details }: AppErrorInput) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  public constructor(message = "API key ausente ou invalida") {
    super({
      statusCode: 401,
      code: "UNAUTHORIZED_API_KEY",
      message,
    });
  }
}

export class ValidationError extends AppError {
  public constructor(details: ApiErrorDetails, message = "Payload invalido") {
    super({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message,
      details,
    });
  }
}

export class NotFoundError extends AppError {
  public constructor(message = "Recurso nao encontrado", code = "RESOURCE_NOT_FOUND") {
    super({
      statusCode: 404,
      code,
      message,
    });
  }
}

export class ConflictError extends AppError {
  public constructor(message = "Conflito de dados", code = "CONFLICT") {
    super({
      statusCode: 409,
      code,
      message,
    });
  }
}

export class PayloadTooLargeError extends AppError {
  public constructor(
    message = "Payload excede o limite permitido",
    code = "PAYLOAD_TOO_LARGE",
  ) {
    super({
      statusCode: 413,
      code,
      message,
    });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  public constructor(
    message = "Tipo de arquivo nao suportado",
    code = "UNSUPPORTED_MEDIA_TYPE",
  ) {
    super({
      statusCode: 415,
      code,
      message,
    });
  }
}
