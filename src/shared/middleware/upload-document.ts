import type { NextFunction, Request, Response } from "express";
import multer, { MulterError } from "multer";
import { env } from "../../config/env";
import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../errors/app-error";

/**
 * Middleware de upload de arquivos do endpoint POST /mensagens/documento.
 *
 * - Usa `memoryStorage`: cada arquivo trafega como Buffer ate ser persistido no
 *   Supabase Storage pelo service. Sem persistencia local em disco.
 * - Limite por arquivo: `DOCUMENT_UPLOAD_MAX_BYTES` (default 100 MB).
 * - Limite de arquivos por requisicao: `DOCUMENT_BATCH_MAX_FILES` (default 10).
 * - `fileFilter` valida o MIME contra a lista de tipos suportados pelo
 *   contrato com a Meta (ver `schema-documento.ts`).
 */

const ALLOWED_DOCUMENT_MIME_TYPES = new Set<string>([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const FILES_FIELD_NAME = "files";

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.DOCUMENT_UPLOAD_MAX_BYTES,
    files: env.DOCUMENT_BATCH_MAX_FILES,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      callback(
        new UnsupportedMediaTypeError(
          `Tipo de arquivo nao suportado: ${file.mimetype}`,
        ),
      );
      return;
    }
    callback(null, true);
  },
});

const translateMulterError = (error: MulterError): Error => {
  if (error.code === "LIMIT_FILE_SIZE") {
    return new PayloadTooLargeError(
      `Arquivo excede o limite de ${env.DOCUMENT_UPLOAD_MAX_BYTES} bytes`,
    );
  }
  if (error.code === "LIMIT_UNEXPECTED_FILE") {
    return new ValidationError([
      {
        path: error.field ?? FILES_FIELD_NAME,
        message: "Campo de arquivo nao esperado neste endpoint",
      },
    ]);
  }
  if (error.code === "LIMIT_FILE_COUNT") {
    return new ValidationError([
      {
        path: FILES_FIELD_NAME,
        message: `Numero de arquivos excede o limite de ${env.DOCUMENT_BATCH_MAX_FILES} por requisicao`,
      },
    ]);
  }
  return new ValidationError([
    {
      path: error.field ?? FILES_FIELD_NAME,
      message: error.message,
    },
  ]);
};

export const uploadDocumentMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const handler = documentUpload.array(FILES_FIELD_NAME, env.DOCUMENT_BATCH_MAX_FILES);
  handler(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof MulterError) {
      next(translateMulterError(err));
      return;
    }
    next(err as Error);
  });
};

export { FILES_FIELD_NAME };
