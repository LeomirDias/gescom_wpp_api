import type { RequestWithId } from "../middleware/request-id";

export type QueueName =
  | "send-text-message"
  | "send-text-message-dead-letter"
  | "send-document-message"
  | "send-document-message-dead-letter";

export type QueueJobMetadata = {
  jobId: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

export type SendTextMessageJobPayload = {
  jobId: string;
  createdAt: string;
  tenantId: string;
  apiKeyPrefix?: string;
  metaPhoneNumberId: string;
  to: string;
  message: string;
  sourceSystem: string;
  correlationId?: string;
  requestId: RequestWithId["requestId"];
};

export type DocumentJobAttachment = {
  path: string;
  caption: string;
  filename?: string;
};

export type SendDocumentMessageJobPayload = {
  jobId: string;
  createdAt: string;
  tenantId: string;
  apiKeyPrefix?: string;
  metaPhoneNumberId: string;
  to: string;
  sourceSystem: string;
  correlationId?: string;
  requestId: RequestWithId["requestId"];
  document: DocumentJobAttachment;
};

export type QueueJob<TPayload> = {
  queueName: QueueName;
  payload: TPayload;
  metadata: QueueJobMetadata;
};

export type QueueHandler<TPayload> = (
  job: QueueJob<TPayload>,
) => Promise<void> | void;

export type QueueSubscription = {
  unsubscribe: () => void;
};

export type QueueSnapshot = Partial<Record<QueueName, Array<QueueJob<unknown>>>>;

export type DeadLetterReason = {
  reason: string;
  reasonCode?: string;
};

export type DeadLetterJobPayload = {
  originalQueueName: QueueName;
  failedAt: string;
  reason: string;
  reasonCode?: string;
  originalPayload: unknown;
  originalMetadata: QueueJobMetadata;
};

/**
 * Contrato único de fila para produtor e consumidor.
 *
 * Regras de comportamento:
 * - `publish`: apenas enfileira e retorna o job criado.
 * - `consume`: registra um handler para consumir jobs de uma fila.
 * - `ack`: confirma processamento com sucesso (sem reenqueue).
 * - `retry`: reprocessa o job incrementando tentativa e registrando erro.
 *   Aceita `delayMs` opcional para backoff antes de re-enfileirar.
 * - Handlers podem lançar `RetryableQueueError` (com `delayMs`) ou
 *   `NonRetryableQueueError` para sinalizar a intenção de retry/dead-letter.
 *   Qualquer outro erro é tratado como retry sem delay específico.
 * - Erros no handler devem ser tratados pela implementação concreta, sem
 *   derrubar o processo principal.
 */

export interface QueueConnection {
  publish<TPayload>(
    queueName: QueueName,
    payload: TPayload,
  ): Promise<QueueJob<TPayload>>;
  consume<TPayload>(
    queueName: QueueName,
    handler: QueueHandler<TPayload>,
  ): Promise<QueueSubscription>;
  ack<TPayload>(job: QueueJob<TPayload>): Promise<void>;
  retry<TPayload>(
    job: QueueJob<TPayload>,
    reason: DeadLetterReason,
    delayMs?: number,
  ): Promise<void>;
  deadLetter<TPayload>(
    job: QueueJob<TPayload>,
    reason: DeadLetterReason,
  ): Promise<void>;
  snapshot(): Promise<QueueSnapshot>;
  shutdown(): Promise<void>;
}
