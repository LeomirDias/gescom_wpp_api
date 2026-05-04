/**
 * Erros neutros para o contrato de fila.
 *
 * O worker deve traduzir erros de dominio (ex.: MetaApiError) para um destes
 * tipos, permitindo que a implementacao da fila decida entre re-enfileirar com
 * delay ou encaminhar para fluxo de falha definitiva sem acoplar-se ao dominio.
 */

export class RetryableQueueError extends Error {
  public readonly delayMs: number;
  public readonly reasonCode?: string;

  public constructor(message: string, delayMs = 0, reasonCode?: string) {
    super(message);
    this.name = "RetryableQueueError";
    this.delayMs = Math.max(0, Math.floor(delayMs));
    this.reasonCode = reasonCode;
  }
}

export class NonRetryableQueueError extends Error {
  public readonly reasonCode?: string;

  public constructor(message: string, reasonCode?: string) {
    super(message);
    this.name = "NonRetryableQueueError";
    this.reasonCode = reasonCode;
  }
}

export const isRetryableQueueError = (
  error: unknown,
): error is RetryableQueueError => {
  return error instanceof RetryableQueueError;
};

export const isNonRetryableQueueError = (
  error: unknown,
): error is NonRetryableQueueError => {
  return error instanceof NonRetryableQueueError;
};
