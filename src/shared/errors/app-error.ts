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
  public constructor(
    message = "Conflito de dados",
    code = "CONFLICT",
    details?: ApiErrorDetails,
  ) {
    super({
      statusCode: 409,
      code,
      message,
      details,
    });
  }
}

/**
 * Mesmo correlationId e mesmo conteudo ja enviados; esta requisicao nao aciona Meta de novo.
 * HTTP 409 para nao confundir com 200 apos meta_http_response + lifecycle_success.
 */
export class IdempotencyReplayError extends AppError {
  public constructor(details: ApiErrorDetails) {
    super({
      statusCode: 409,
      code: "IDEMPOTENCY_REPLAY",
      message:
        "Este correlationId ja teve envio concluido na Meta; esta requisicao nao gerou novo envio nem logs meta_http_response/lifecycle_success. Consulte `details` para os ids do envio original.",
      details,
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

export class SendFailedError extends AppError {
  public constructor(reason: string, reasonCode?: string) {
    super({
      statusCode: 502,
      code: "SEND_FAILED",
      message: reason,
      details: reasonCode ? [{ path: "reasonCode", message: reasonCode }] : undefined,
    });
  }
}

export class GatewayTimeoutError extends AppError {
  public constructor(message = "Envio nao concluido no tempo limite") {
    super({
      statusCode: 504,
      code: "SEND_TIMEOUT",
      message,
    });
  }
}

/**
 * Batch de documentos com um ou mais itens que nao concluiram envio na Meta.
 * HTTP 502 para nao retornar 200 quando `totalFailed > 0`.
 */
export class BatchSendFailedError extends AppError {
  public constructor(
    totalSent: number,
    totalFailed: number,
    batchId: string,
    failedItems: Array<{
      index: number;
      correlationId: string;
      error: string;
      errorCode?: string;
    }>,
  ) {
    const details: ApiErrorDetails = [
      { path: "batchId", message: batchId },
      { path: "totalSent", message: String(totalSent) },
      { path: "totalFailed", message: String(totalFailed) },
      ...failedItems.flatMap((item) => {
        const entries: ApiErrorDetails = [
          { path: `items[${item.index}].correlationId`, message: item.correlationId },
          { path: `items[${item.index}].error`, message: item.error },
        ];
        if (item.errorCode) {
          entries.push({
            path: `items[${item.index}].errorCode`,
            message: item.errorCode,
          });
        }
        return entries;
      }),
    ];

    super({
      statusCode: 502,
      code: "BATCH_SEND_FAILED",
      message: `Batch com falha: ${totalFailed} de ${totalSent + totalFailed} documento(s) nao enviado(s)`,
      details,
    });
  }
}
