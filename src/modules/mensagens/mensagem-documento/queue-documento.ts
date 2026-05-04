import {
  SEND_DOCUMENT_MESSAGE_QUEUE_NAME,
  getQueueConnection,
} from "../../../shared/queue/queue-factory";
import type {
  QueueJob,
  SendDocumentMessageJobPayload,
} from "../../../shared/queue/queue-connection.interface";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";

export const publishSendDocumentMessage = async (
  payload: SendDocumentMessageJobPayload,
): Promise<QueueJob<SendDocumentMessageJobPayload>> => {
  const job = await getQueueConnection().publish(
    SEND_DOCUMENT_MESSAGE_QUEUE_NAME,
    payload,
  );

  logLifecycle("queued", {
    requestId: payload.requestId,
    jobId: job.metadata.jobId,
    attempt: job.metadata.attempt,
    queueName: SEND_DOCUMENT_MESSAGE_QUEUE_NAME,
    tenantId: payload.tenantId,
    apiKeyPrefix: payload.apiKeyPrefix,
    metaPhoneNumberId: payload.metaPhoneNumberId,
  });

  return job;
};
