import { MetaApiError } from "../../../shared/errors/meta-errors";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";
import type {
  QueueJob,
  QueueSubscription,
  SendDocumentMessageJobPayload,
} from "../../../shared/queue/queue-connection.interface";
import {
  NonRetryableQueueError,
  RetryableQueueError,
} from "../../../shared/queue/queue-errors";
import {
  LocalDocumentValidationError,
  validateAndResolveLocalDocument,
} from "./document-local-file";
import {
  SEND_DOCUMENT_MESSAGE_QUEUE_NAME,
  subscribeSendDocumentMessageQueue,
} from "../../../shared/queue/queue-factory";
import {
  MetaDocumentProvider,
  metaDocumentProvider as defaultMetaDocumentProvider,
} from "./meta-provider-documento";
import { computeBackoffMs } from "../mensagem-texto/worker";

/**
 * Worker consumidor da fila `send-document-message`:
 *   - dispara `MetaDocumentProvider.sendDocumentMessage`;
 *   - classifica erros em transitorios/definitivos (mesma politica de texto);
 *   - aplica backoff exponencial + jitter compartilhado com o worker de texto;
 *   - emite logs de lifecycle (processing, success, failed, retry_scheduled).
 */

type HandleOptions = {
  provider?: MetaDocumentProvider;
};

export const handleSendDocumentMessageJob = async (
  job: QueueJob<SendDocumentMessageJobPayload>,
  options: HandleOptions = {},
): Promise<void> => {
  const provider = options.provider ?? defaultMetaDocumentProvider;
  const { payload, metadata } = job;
  const startedAt = Date.now();

  logLifecycle("processing", {
    requestId: payload.requestId,
    jobId: metadata.jobId,
    attempt: metadata.attempt,
    queueName: job.queueName,
    tenantId: payload.tenantId,
    apiKeyPrefix: payload.apiKeyPrefix,
    metaPhoneNumberId: payload.metaPhoneNumberId,
  });

  try {
    const resolvedDocument = await validateAndResolveLocalDocument({
      path: payload.document.path,
      filename: payload.document.filename,
    });

    const result = await provider.sendDocumentMessage(
      payload,
      resolvedDocument,
    );

    logLifecycle("success", {
      requestId: payload.requestId,
      jobId: metadata.jobId,
      attempt: metadata.attempt,
      durationMs: Date.now() - startedAt,
      queueName: job.queueName,
      tenantId: payload.tenantId,
      apiKeyPrefix: payload.apiKeyPrefix,
      metaPhoneNumberId: payload.metaPhoneNumberId,
      waMessageId: result.waMessageId,
      waContactId: result.waContactId,
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof LocalDocumentValidationError) {
      logLifecycle("failed", {
        requestId: payload.requestId,
        jobId: metadata.jobId,
        attempt: metadata.attempt,
        durationMs,
        queueName: job.queueName,
        tenantId: payload.tenantId,
        apiKeyPrefix: payload.apiKeyPrefix,
        metaPhoneNumberId: payload.metaPhoneNumberId,
        reason,
        reasonCode: "local_document_validation",
      });

      throw new NonRetryableQueueError(reason, "local_document_validation");
    }

    const isMetaError = error instanceof MetaApiError;
    const isRetryable = isMetaError ? error.isRetryable : true;

    if (!isRetryable) {
      logLifecycle("failed", {
        requestId: payload.requestId,
        jobId: metadata.jobId,
        attempt: metadata.attempt,
        durationMs,
        queueName: job.queueName,
        tenantId: payload.tenantId,
        apiKeyPrefix: payload.apiKeyPrefix,
        metaPhoneNumberId: payload.metaPhoneNumberId,
        reason,
        reasonCode: isMetaError
          ? `meta:${error.metaCode ?? error.httpStatus}`
          : "unknown",
      });

      throw new NonRetryableQueueError(
        reason,
        isMetaError ? `meta:${error.metaCode ?? error.httpStatus}` : undefined,
      );
    }

    const delayMs = computeBackoffMs(metadata.attempt);
    const retryReasonCode = isMetaError
      ? `meta:${error.metaCode ?? error.httpStatus}`
      : "unknown";

    logLifecycle("retry_scheduled", {
      requestId: payload.requestId,
      jobId: metadata.jobId,
      attempt: metadata.attempt,
      durationMs,
      delayMs,
      queueName: job.queueName,
      tenantId: payload.tenantId,
      apiKeyPrefix: payload.apiKeyPrefix,
      metaPhoneNumberId: payload.metaPhoneNumberId,
      reason,
      reasonCode: retryReasonCode,
    });

    throw new RetryableQueueError(reason, delayMs, retryReasonCode);
  }
};

export const startSendDocumentMessageWorker = async (
  options: HandleOptions = {},
): Promise<QueueSubscription> => {
  const subscription = await subscribeSendDocumentMessageQueue(async (job) => {
    await handleSendDocumentMessageJob(job, options);
  });

  console.info({
    event: "worker_started",
    queueName: SEND_DOCUMENT_MESSAGE_QUEUE_NAME,
  });

  return subscription;
};
