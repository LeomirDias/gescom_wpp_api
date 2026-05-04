import {
  SEND_TEXT_MESSAGE_QUEUE_NAME,
  getQueueConnection,
} from "../../../shared/queue/queue-factory";
import type {
  QueueJob,
  SendTextMessageJobPayload,
} from "../../../shared/queue/queue-connection.interface";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";

export const publishSendTextMessage = async (
  payload: SendTextMessageJobPayload,
): Promise<QueueJob<SendTextMessageJobPayload>> => {
  const job = await getQueueConnection().publish(
    SEND_TEXT_MESSAGE_QUEUE_NAME,
    payload,
  );

  logLifecycle("queued", {
    requestId: payload.requestId,
    jobId: job.metadata.jobId,
    attempt: job.metadata.attempt,
    queueName: SEND_TEXT_MESSAGE_QUEUE_NAME,
    tenantId: payload.tenantId,
    apiKeyPrefix: payload.apiKeyPrefix,
    metaPhoneNumberId: payload.metaPhoneNumberId,
  });

  return job;
};
