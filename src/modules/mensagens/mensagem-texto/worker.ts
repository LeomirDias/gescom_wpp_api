import { MetaApiError } from "../../../shared/errors/meta-errors";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";
import type {
  QueueJob,
  QueueSubscription,
  SendTextMessageJobPayload,
} from "../../../shared/queue/queue-connection.interface";
import {
  NonRetryableQueueError,
  RetryableQueueError,
} from "../../../shared/queue/queue-errors";
import {
  SEND_TEXT_MESSAGE_QUEUE_NAME,
  subscribeSendTextMessageQueue,
} from "../../../shared/queue/queue-factory";
import {
  MetaProvider,
  metaProvider as defaultMetaProvider,
} from "./meta-provider";
import { jobResultRegistry } from "../job-result-registry";

/**
 * Worker consumidor da fila `send-text-message`:
 *   - dispara `MetaProvider.sendTextMessage`;
 *   - classifica erros em transitorios/definitivos;
 *   - aplica backoff exponencial + jitter para retries;
 *   - emite logs de lifecycle (processing, success, failed, retry_scheduled).
 */

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 30_000;

export const computeBackoffMs = (attempt: number): number => {
  const safeAttempt = Math.max(1, attempt);
  const exp = Math.min(
    BACKOFF_CAP_MS,
    BACKOFF_BASE_MS * 2 ** (safeAttempt - 1),
  );
  const jitter = Math.floor(Math.random() * (exp / 2));
  return exp + jitter;
};

type HandleOptions = {
  provider?: MetaProvider;
};

export const handleSendTextMessageJob = async (
  job: QueueJob<SendTextMessageJobPayload>,
  options: HandleOptions = {},
): Promise<void> => {
  const provider = options.provider ?? defaultMetaProvider;
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
    const result = await provider.sendTextMessage(payload);

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

    jobResultRegistry.resolveSuccess(metadata.jobId, result);
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;
    const reason = error instanceof Error ? error.message : String(error);
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

export const startSendTextMessageWorker = async (
  options: HandleOptions = {},
): Promise<QueueSubscription> => {
  const subscription = await subscribeSendTextMessageQueue(async (job) => {
    await handleSendTextMessageJob(job, options);
  });

  console.info({
    event: "worker_started",
    queueName: SEND_TEXT_MESSAGE_QUEUE_NAME,
  });

  return subscription;
};
