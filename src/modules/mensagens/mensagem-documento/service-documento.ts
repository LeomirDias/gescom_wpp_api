import { randomUUID } from "node:crypto";
import { env } from "../../../config/env";
import type { MessageAuthContext } from "../../../shared/middleware/auth-api-key";
import type {
  DocumentJobAttachment,
  DocumentStorageRef,
  SendDocumentMessageJobPayload,
} from "../../../shared/queue/queue-connection.interface";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";

import type { PostMensagemDocumentoInput } from "./schema-documento";
import { publishSendDocumentMessage } from "./queue-documento";
import {
  buildIdempotencyKey,
  InMemoryIdempotencyStore,
} from "../idempotency-store";
import {
  uploadDocumentBuffer as defaultUploadDocumentBuffer,
} from "./storage-documento";

type QueuePublication = {
  requestId: string;
  jobId: string;
  status: "queued";
  createdAt: string;
};

const DOCUMENT_IDEMPOTENCY_SCOPE = "document";

export type DocumentUploadInput = {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
};

type StorageUploader = (input: {
  tenantId: string;
  jobId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) => Promise<DocumentStorageRef>;

const resolveFilename = (
  metadataFilename: string | undefined,
  originalFilename: string,
): string => {
  if (metadataFilename && metadataFilename.trim().length > 0) {
    return metadataFilename.trim();
  }
  return originalFilename.trim() || "arquivo";
};

const buildDocumentAttachment = (
  input: PostMensagemDocumentoInput,
  upload: DocumentUploadInput,
  storageRef: DocumentStorageRef,
): DocumentJobAttachment => ({
  caption: input.document.caption,
  filename: resolveFilename(input.document.filename, upload.originalFilename),
  storage: storageRef,
});

export class MensagensDocumentoService {
  private readonly inFlightPublications = new Map<
    string,
    Promise<QueuePublication>
  >();

  public constructor(
    private readonly publisher: (
      payload: SendDocumentMessageJobPayload,
    ) => Promise<unknown> = publishSendDocumentMessage,
    private readonly idempotencyStore = new InMemoryIdempotencyStore<QueuePublication>(
      env.IDEMPOTENCY_TTL_MS,
      env.IDEMPOTENCY_CLEANUP_INTERVAL_MS,
    ),
    private readonly uploadDocument: StorageUploader = defaultUploadDocumentBuffer,
  ) {}

  public async enfileirarMensagemDocumento(
    requestId: string,
    input: PostMensagemDocumentoInput,
    upload: DocumentUploadInput,
    authContext: MessageAuthContext,
  ): Promise<QueuePublication> {
    if (!input.correlationId) {
      return this.enqueueNewPublication(requestId, input, upload, authContext);
    }

    const key = buildIdempotencyKey(
      `${DOCUMENT_IDEMPOTENCY_SCOPE}:${input.sourceSystem}`,
      input.correlationId,
    );
    const existing = this.idempotencyStore.get(key);
    if (existing) {
      logLifecycle("idempotency_hit", {
        requestId,
        jobId: existing.jobId,
        correlationId: input.correlationId,
        queueName: "send-document-message",
      });
      return { ...existing, requestId };
    }

    const publication = await this.getOrCreatePublication(
      key,
      requestId,
      input,
      upload,
      authContext,
    );
    const eventName =
      publication.requestId === requestId
        ? "idempotency_miss"
        : "idempotency_hit";
    const output = { ...publication, requestId };

    logLifecycle(eventName, {
      requestId,
      jobId: output.jobId,
      correlationId: input.correlationId,
      queueName: "send-document-message",
    });
    return output;
  }

  private async getOrCreatePublication(
    key: string,
    requestId: string,
    input: PostMensagemDocumentoInput,
    upload: DocumentUploadInput,
    authContext: MessageAuthContext,
  ): Promise<QueuePublication> {
    const ongoing = this.inFlightPublications.get(key);
    if (ongoing) {
      return ongoing;
    }

    const publishPromise = this.enqueueNewPublication(
      requestId,
      input,
      upload,
      authContext,
    );
    this.inFlightPublications.set(key, publishPromise);

    try {
      const publication = await publishPromise;
      this.idempotencyStore.set(key, publication);
      return publication;
    } finally {
      this.inFlightPublications.delete(key);
    }
  }

  private async enqueueNewPublication(
    requestId: string,
    input: PostMensagemDocumentoInput,
    upload: DocumentUploadInput,
    authContext: MessageAuthContext,
  ): Promise<QueuePublication> {
    const now = new Date().toISOString();
    const jobId = randomUUID();
    const filename = resolveFilename(
      input.document.filename,
      upload.originalFilename,
    );

    const storageRef = await this.uploadDocument({
      tenantId: authContext.tenantId,
      jobId,
      filename,
      mimeType: upload.mimeType,
      buffer: upload.buffer,
    });

    const payload: SendDocumentMessageJobPayload = {
      jobId,
      createdAt: now,
      tenantId: authContext.tenantId,
      apiKeyPrefix: authContext.apiKeyPrefix,
      metaPhoneNumberId: authContext.metaPhoneNumberId,
      to: input.to,
      sourceSystem: input.sourceSystem,
      correlationId: input.correlationId,
      requestId,
      document: buildDocumentAttachment(input, upload, storageRef),
    };

    await this.publisher(payload);

    return {
      requestId,
      jobId,
      status: "queued",
      createdAt: now,
    };
  }
}
