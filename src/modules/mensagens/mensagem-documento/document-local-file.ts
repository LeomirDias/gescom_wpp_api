import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Za-z]:\\.+/;
const MAX_DOCUMENT_SIZE_BYTES = 100 * 1024 * 1024;

const SUPPORTED_MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export type LocalDocumentFile = {
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export class LocalDocumentValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocalDocumentValidationError";
  }
}

export const validateAndResolveLocalDocument = async (input: {
  path: string;
  filename?: string;
}): Promise<LocalDocumentFile> => {
  const normalizedPath = input.path.trim();
  if (!WINDOWS_ABSOLUTE_PATH_REGEX.test(normalizedPath)) {
    throw new LocalDocumentValidationError(
      "Campo 'document.path' deve ser um caminho absoluto local do Windows",
    );
  }

  const extension = path.extname(normalizedPath).toLowerCase();
  const mimeType = SUPPORTED_MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new LocalDocumentValidationError(
      "Tipo de arquivo nao suportado para envio de documento",
    );
  }

  try {
    await access(normalizedPath, constants.R_OK);
  } catch {
    throw new LocalDocumentValidationError(
      "Arquivo informado em 'document.path' nao existe ou sem permissao de leitura",
    );
  }

  const stats = await stat(normalizedPath);
  if (!stats.isFile()) {
    throw new LocalDocumentValidationError(
      "Campo 'document.path' deve apontar para um arquivo valido",
    );
  }

  if (stats.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new LocalDocumentValidationError(
      "Arquivo em 'document.path' excede o limite de 100MB",
    );
  }

  return {
    path: normalizedPath,
    filename: input.filename?.trim() || path.basename(normalizedPath),
    mimeType,
    sizeBytes: stats.size,
  };
};
