import { env } from "../../config/env";
import { LocalMemoryQueueConnection } from "./local-memory-queue-connection";
import { RedisQueueConnection } from "./redis-connection";
import type {
  QueueConnection,
  QueueHandler,
  QueueJob,
  QueueSnapshot,
  QueueSubscription,
  SendDocumentMessageJobPayload,
  SendTextMessageJobPayload,
} from "./queue-connection.interface";

export const SEND_TEXT_MESSAGE_QUEUE_NAME = "send-text-message";
export const SEND_TEXT_MESSAGE_DEAD_LETTER_QUEUE_NAME = "send-text-message-dead-letter";
export const SEND_DOCUMENT_MESSAGE_QUEUE_NAME = "send-document-message";
export const SEND_DOCUMENT_MESSAGE_DEAD_LETTER_QUEUE_NAME =
  "send-document-message-dead-letter";

let queueConnectionSingleton: QueueConnection | null = null;

//Cria a conexao com a fila
export const createQueueConnection = (): QueueConnection => {
  if (env.QUEUE_DRIVER === "memory") {
    return new LocalMemoryQueueConnection(
      env.QUEUE_MAX_ATTEMPTS,
      env.DEAD_LETTER_RETENTION_MS,
    );
  }

  if (env.QUEUE_DRIVER === "redis") {
    const redisConnectionInput = env.REDIS_URL
      ? {
          url: env.REDIS_URL,
        }
      : {
          host: env.REDIS_HOST ?? "127.0.0.1",
          port: env.REDIS_PORT ?? 6379,
          password: env.REDIS_PASSWORD,
        };

    return new RedisQueueConnection(
      redisConnectionInput,
      env.QUEUE_MAX_ATTEMPTS,
      env.DEAD_LETTER_RETENTION_MS,
      env.QUEUE_PREFIX,
    );
  }

  throw new Error(
    `QUEUE_DRIVER nao suportado: ${env.QUEUE_DRIVER satisfies never}`,
  );
};

//Inicializa a conexao com a fila
export const initializeQueueConnection = (): QueueConnection => {
  if (!queueConnectionSingleton) {
    queueConnectionSingleton = createQueueConnection();
  }

  return queueConnectionSingleton;
};

//Obtem a conexao com a fila
export const getQueueConnection = (): QueueConnection => {
  if (!queueConnectionSingleton) {
    return initializeQueueConnection();
  }

  return queueConnectionSingleton;
};

//Fecha a conexao com a fila
export const shutdownQueueConnection = async (): Promise<void> => {
  if (!queueConnectionSingleton) {
    return;
  }

  await queueConnectionSingleton.shutdown();
  queueConnectionSingleton = null;
};

//Publica um job na fila de envio de mensagens de texto
export const publishSendTextMessageJob = async (
  payload: SendTextMessageJobPayload,
): Promise<QueueJob<SendTextMessageJobPayload>> => {
  return getQueueConnection().publish(SEND_TEXT_MESSAGE_QUEUE_NAME, payload);
};

//Inscreve um handler na fila de envio de mensagens de texto
export const subscribeSendTextMessageQueue = async (
  handler: QueueHandler<SendTextMessageJobPayload>,
): Promise<QueueSubscription> => {
  return getQueueConnection().consume(SEND_TEXT_MESSAGE_QUEUE_NAME, handler);
};

//Publica um job na fila de envio de mensagens com documento
export const publishSendDocumentMessageJob = async (
  payload: SendDocumentMessageJobPayload,
): Promise<QueueJob<SendDocumentMessageJobPayload>> => {
  return getQueueConnection().publish(SEND_DOCUMENT_MESSAGE_QUEUE_NAME, payload);
};

//Inscreve um handler na fila de envio de mensagens com documento
export const subscribeSendDocumentMessageQueue = async (
  handler: QueueHandler<SendDocumentMessageJobPayload>,
): Promise<QueueSubscription> => {
  return getQueueConnection().consume(SEND_DOCUMENT_MESSAGE_QUEUE_NAME, handler);
};

//Obtem um snapshot da fila de envio de mensagens de texto
export const getQueueSnapshot = async (): Promise<QueueSnapshot> => {
  return getQueueConnection().snapshot();
};
