/**
 * Contratos de request/response da Meta para mensagem de texto.
 * Alinhado com docs/whatsapp-cloud-api-payloads.md.
 */

import { SendTextMessageJobPayload } from "../../../shared/queue/queue-connection.interface";

export type MetaTextMessageRequest = {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: {
    preview_url: boolean;
    body: string;
  };
};

export type MetaSendMessageResponse = {
  messaging_product: "whatsapp";
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
    message_status?: string;
  }>;
};

export type SendTextMessageResult = {
  waMessageId: string;
  waContactId: string;
  input: string;
};

const sanitizeTo = (to: string): string => to.trim();

export const toMetaTextMessagePayload = (
  job: SendTextMessageJobPayload,
): MetaTextMessageRequest => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to: sanitizeTo(job.to),
  type: "text",
  text: {
    preview_url: false,
    body: job.message,
  },
});

export const fromMetaSendMessageResponse = (
  response: MetaSendMessageResponse,
): SendTextMessageResult => {
  const firstMessage = response.messages[0];
  const firstContact = response.contacts[0];

  if (!firstMessage?.id) {
    throw new Error("Resposta da Meta nao contem messages[0].id");
  }

  if (!firstContact?.wa_id) {
    throw new Error("Resposta da Meta nao contem contacts[0].wa_id");
  }

  return {
    waMessageId: firstMessage.id,
    waContactId: firstContact.wa_id,
    input: firstContact.input,
  };
};
