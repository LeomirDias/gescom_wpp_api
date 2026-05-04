import { z } from "zod";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const CORRELATION_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

export const postMensagemTextoSchema = z
  .object({
    to: z
      .string()
      .trim()
      .min(1, "Campo 'to' e obrigatorio")
      .regex(E164_REGEX, "Campo 'to' deve estar no formato E.164"),
    message: z
      .string()
      .trim()
      .min(1, "Campo 'message' e obrigatorio")
      .max(4096, "Campo 'message' excede o limite de 4096 caracteres"),
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
  })
  .strict();

export type PostMensagemTextoInput = z.infer<typeof postMensagemTextoSchema>;

export type PostMensagemTextoAcceptedOutput = {
  requestId: string;
  jobId: string;
  status: "queued";
  createdAt: string;
};
