import type { SendDocumentMessageJobPayload } from "../../../shared/queue/queue-connection.interface";
import {
  fromMetaSendMessageResponse,
  type MetaSendMessageResponse,
  type SendTextMessageResult,
} from "../mensagem-texto/mapper";

/**
 * Contratos de request/response da Meta para mensagem de documento.
 * Alinhado com docs/dev/whatsapp-cloud-api-payloads.md.
 *
 * A resposta da API `/messages` e identica para os diferentes tipos (texto,
 * documento, etc.), por isso reutilizamos `fromMetaSendMessageResponse` do
 * mapper de texto.
 */

export type MetaDocumentObject = {
  id: string;
  caption: string;
  filename?: string;
};

export type MetaDocumentMessageRequest = {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "document";
  document: MetaDocumentObject;
};

export type SendDocumentMessageResult = SendTextMessageResult;

const sanitize = (value: string): string => value.trim();

export const toMetaDocumentMessagePayload = (
  job: SendDocumentMessageJobPayload,
  mediaId: string,
): MetaDocumentMessageRequest => {
  const caption = sanitize(job.document.caption);
  const filename = job.document.filename
    ? sanitize(job.document.filename)
    : undefined;

  const base: MetaDocumentMessageRequest = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: sanitize(job.to),
    type: "document",
    document: {
      id: sanitize(mediaId),
      caption,
      ...(filename ? { filename } : {}),
    },
  };

  return base;
};

export const fromMetaSendDocumentMessageResponse = (
  response: MetaSendMessageResponse,
): SendDocumentMessageResult => fromMetaSendMessageResponse(response);

export type { MetaSendMessageResponse };
