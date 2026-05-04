import path from "node:path";
import { env } from "../../../config/env";
import { supabase } from "../../../lib/supabase/client";
import type { DocumentStorageRef } from "../../../shared/queue/queue-connection.interface";

/**
 * Erros de Storage classificados em duas categorias:
 *  - retryable: falhas transientes (rede, 5xx do Storage). Worker deve repetir.
 *  - non-retryable: erros definitivos (key inexistente, validacao). Vai para
 *    dead-letter sem retry.
 */
export class StorageDocumentError extends Error {
  public readonly retryable: boolean;
  public readonly reasonCode: string;

  public constructor(input: {
    message: string;
    retryable: boolean;
    reasonCode: string;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "StorageDocumentError";
    this.retryable = input.retryable;
    this.reasonCode = input.reasonCode;
    if (input.cause) {
      (this as Error & { cause?: unknown }).cause = input.cause;
    }
  }
}

export type LoadedDocument = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

const SAFE_FILENAME_REGEX = /[^\w.\-]+/g;

const sanitizeFilename = (filename: string): string => {
  const trimmed = filename.trim();
  if (!trimmed) {
    return "arquivo";
  }
  const replaced = trimmed.replace(SAFE_FILENAME_REGEX, "_");
  return replaced.length > 0 ? replaced : "arquivo";
};

const buildDateSegment = (date: Date = new Date()): string => {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export const buildDocumentStorageKey = (input: {
  tenantId: string;
  jobId: string;
  filename: string;
  date?: Date;
}): string => {
  const safeFilename = sanitizeFilename(input.filename);
  const datePart = buildDateSegment(input.date);
  return `tenants/${input.tenantId}/${datePart}/${input.jobId}-${safeFilename}`;
};

export const uploadDocumentBuffer = async (input: {
  tenantId: string;
  jobId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<DocumentStorageRef> => {
  const bucket = env.SUPABASE_DOCUMENTS_BUCKET;
  const key = buildDocumentStorageKey({
    tenantId: input.tenantId,
    jobId: input.jobId,
    filename: input.filename,
  });

  const { error } = await supabase.storage.from(bucket).upload(key, input.buffer, {
    contentType: input.mimeType,
    upsert: false,
  });

  if (error) {
    throw new StorageDocumentError({
      message: `Falha ao persistir documento no Supabase Storage: ${error.message}`,
      retryable: true,
      reasonCode: "storage_upload_failed",
      cause: error,
    });
  }

  return {
    bucket,
    key,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.byteLength,
  };
};

export const downloadDocumentBuffer = async (
  ref: DocumentStorageRef,
): Promise<LoadedDocument> => {
  const { data, error } = await supabase.storage
    .from(ref.bucket)
    .download(ref.key);

  if (error || !data) {
    const message = error?.message ?? "Documento nao encontrado no Storage";
    const reasonCode = /not\s*found/i.test(message)
      ? "storage_object_not_found"
      : "storage_download_failed";
    throw new StorageDocumentError({
      message: `Falha ao baixar documento do Supabase Storage: ${message}`,
      retryable: reasonCode !== "storage_object_not_found",
      reasonCode,
      cause: error ?? undefined,
    });
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength !== ref.sizeBytes) {
    throw new StorageDocumentError({
      message: `Tamanho do documento divergente do esperado (esperado=${ref.sizeBytes}, recebido=${buffer.byteLength})`,
      retryable: false,
      reasonCode: "storage_size_mismatch",
    });
  }

  return {
    buffer,
    filename: path.basename(ref.key),
    mimeType: ref.mimeType,
    sizeBytes: buffer.byteLength,
  };
};
