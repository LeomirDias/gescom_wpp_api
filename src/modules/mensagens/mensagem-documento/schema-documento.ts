import { z } from "zod";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const CORRELATION_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;
const FILENAME_REGEX = /^[\w\-.\s()]+\.[A-Za-z0-9]{2,6}$/;

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

const documentoSchema = z
  .object({
    caption: z
      .string()
      .trim()
      .min(1, "Campo 'document.caption' e obrigatorio")
      .max(1024, "Campo 'document.caption' excede o limite de 1024 caracteres"),
    filename: z
      .string()
      .trim()
      .min(1, "Campo 'document.filename' nao pode ser vazio")
      .max(255, "Campo 'document.filename' excede o limite de 255 caracteres")
      .regex(
        FILENAME_REGEX,
        "Campo 'document.filename' deve conter nome e extensao (ex.: contrato.pdf)",
      )
      .optional(),
  })
  .strict();

export const postMensagemDocumentoSchema = z
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
    correlationId: z
      .string()
      .trim()
      .min(1, "Campo 'correlationId' e obrigatorio")
      .regex(
        CORRELATION_ID_REGEX,
        "Campo 'correlationId' deve ter entre 8 e 128 caracteres alfanumericos, underscore ou hifen",
      ),
    document: documentoSchema,
  })
  .strict();

export type PostMensagemDocumentoInput = z.infer<
  typeof postMensagemDocumentoSchema
>;

export type PostMensagemDocumentoAcceptedOutput = {
  requestId: string;
  jobId: string;
  status: "queued";
  createdAt: string;
};

export { ALLOWED_DOCUMENT_MIME_TYPES };
