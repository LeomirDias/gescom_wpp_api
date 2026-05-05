import { z } from "zod";
import { env } from "../../../config/env";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const CORRELATION_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;
const FILENAME_REGEX = /^[\w\-.\s()]+\.[A-Za-z0-9]{2,6}$/;
const CLIENT_FILE_KEY_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

const documentoBatchItemSchema = z
  .object({
    caption: z
      .string()
      .trim()
      .min(1, "Campo 'caption' e obrigatorio")
      .max(1024, "Campo 'caption' excede o limite de 1024 caracteres"),
    filename: z
      .string()
      .trim()
      .min(1, "Campo 'filename' nao pode ser vazio")
      .max(255, "Campo 'filename' excede o limite de 255 caracteres")
      .regex(
        FILENAME_REGEX,
        "Campo 'filename' deve conter nome e extensao (ex.: contrato.pdf)",
      )
      .optional(),
    correlationId: z
      .string()
      .trim()
      .min(1, "Campo 'correlationId' e obrigatorio")
      .regex(
        CORRELATION_ID_REGEX,
        "Campo 'correlationId' deve ter entre 8 e 128 caracteres alfanumericos, underscore ou hifen",
      ),
    clientFileKey: z
      .string()
      .trim()
      .min(1, "Campo 'clientFileKey' nao pode ser vazio")
      .max(64, "Campo 'clientFileKey' excede o limite de 64 caracteres")
      .regex(
        CLIENT_FILE_KEY_REGEX,
        "Campo 'clientFileKey' deve conter apenas caracteres alfanumericos, underscore ou hifen",
      )
      .optional(),
  })
  .strict();

export const postMensagemDocumentoBatchSchema = z
  .object({
    to: z
      .string()
      .trim()
      .min(1, "Campo 'to' e obrigatorio")
      .regex(E164_REGEX, "Campo 'to' deve estar no formato E.164"),
    sourceSystem: z
      .string()
      .trim()
      .min(1, "Campo 'sourceSystem' e obrigatorio")
      .max(100, "Campo 'sourceSystem' excede o limite de 100 caracteres"),
    documents: z
      .array(documentoBatchItemSchema)
      .min(1, "Campo 'documents' deve conter ao menos um item")
      .max(
        env.DOCUMENT_BATCH_MAX_FILES,
        `Campo 'documents' excede o limite de ${env.DOCUMENT_BATCH_MAX_FILES} itens`,
      ),
  })
  .strict();

export type BatchDocumentItem = z.infer<typeof documentoBatchItemSchema>;
export type PostMensagemDocumentoBatchInput = z.infer<
  typeof postMensagemDocumentoBatchSchema
>;

export type BatchQueuedItem = {
  index: number;
  clientFileKey?: string;
  correlationId: string;
  jobId: string;
  status: "queued";
  createdAt: string;
};

export type BatchFailedItem = {
  index: number;
  clientFileKey?: string;
  correlationId: string;
  status: "failed";
  error: string;
};

export type BatchResponseItem = BatchQueuedItem | BatchFailedItem;

export type PostMensagemDocumentoBatchAcceptedOutput = {
  requestId: string;
  batchId: string;
  totalQueued: number;
  totalFailed: number;
  items: BatchResponseItem[];
};

export { ALLOWED_DOCUMENT_MIME_TYPES };
