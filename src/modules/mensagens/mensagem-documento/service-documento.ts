import { randomUUID } from "node:crypto";
import { env } from "../../../config/env";
import type { MessageAuthContext } from "../../../shared/middleware/auth-api-key";
import type {
  DocumentJobAttachment,
  DocumentStorageRef,
  SendDocumentMessageJobPayload,
} from "../../../shared/queue/queue-connection.interface";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";

import type {
  BatchDocumentItem,
  BatchFailedItem,
  BatchQueuedItem,
  BatchResponseItem,
  PostMensagemDocumentoBatchInput,
  PostMensagemDocumentoBatchAcceptedOutput,
} from "./schema-documento";
import { publishSendDocumentMessage } from "./queue-documento";
import {
  buildIdempotencyKey,
  InMemoryIdempotencyStore,
} from "../idempotency-store";
import {
  uploadDocumentBuffer as defaultUploadDocumentBuffer,
} from "./storage-documento";

export type DocumentUploadInput = {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
};

type QueuedItemPublication = {
  jobId: string;
  status: "queued";
  createdAt: string;
};

type StorageUploader = (input: {
  tenantId: string;
  jobId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) => Promise<DocumentStorageRef>;

const DOCUMENT_IDEMPOTENCY_SCOPE = "document";

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
  item: BatchDocumentItem,
  upload: DocumentUploadInput,
  storageRef: DocumentStorageRef,
): DocumentJobAttachment => ({
  caption: item.caption,
  filename: resolveFilename(item.filename, upload.originalFilename),
  storage: storageRef,
});

export class MensagensDocumentoService {
  private readonly inFlightPublications = new Map<
    string,
    Promise<QueuedItemPublication>
  >();

  public constructor(
    private readonly publisher: (
      payload: SendDocumentMessageJobPayload,
    ) => Promise<unknown> = publishSendDocumentMessage,
    private readonly idempotencyStore = new InMemoryIdempotencyStore<QueuedItemPublication>(
      env.IDEMPOTENCY_TTL_MS,
      env.IDEMPOTENCY_CLEANUP_INTERVAL_MS,
    ),
    private readonly uploadDocument: StorageUploader = defaultUploadDocumentBuffer,
  ) {}

  public async enfileirarMensagemDocumentoBatch(
    requestId: string,
    input: PostMensagemDocumentoBatchInput,
    uploads: DocumentUploadInput[],
    authContext: MessageAuthContext,
  ): Promise<PostMensagemDocumentoBatchAcceptedOutput> {
    const batchId = randomUUID();

    const itemResults = await Promise.allSettled(
      input.documents.map((docItem, index) =>
        this.processDocumentItem(
          requestId,
          batchId,
          index,
          input,
          docItem,
          uploads[index],
          authContext,
        ),
      ),
    );

    const items: BatchResponseItem[] = itemResults.map((result, index) => {
      const docItem = input.documents[index];
      if (result.status === "fulfilled") {
        const queuedItem: BatchQueuedItem = {
          index,
          correlationId: docItem.correlationId,
          jobId: result.value.jobId,
          status: "queued",
          createdAt: result.value.createdAt,
          ...(docItem.clientFileKey !== undefined
            ? { clientFileKey: docItem.clientFileKey }
            : {}),
        };
        return queuedItem;
      }

      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      const failedItem: BatchFailedItem = {
        index,
        correlationId: docItem.correlationId,
        status: "failed",
        error: reason,
        ...(docItem.clientFileKey !== undefined
          ? { clientFileKey: docItem.clientFileKey }
          : {}),
      };
      return failedItem;
    });

    const totalQueued = items.filter((item) => item.status === "queued").length;
    const totalFailed = items.filter((item) => item.status === "failed").length;

    return {
      requestId,
      batchId,
      totalQueued,
      totalFailed,
      items,
    };
  }

  private async processDocumentItem(
    requestId: string,
    batchId: string,
    index: number,
    input: PostMensagemDocumentoBatchInput,
    docItem: BatchDocumentItem,
    upload: DocumentUploadInput,
    authContext: MessageAuthContext,
  ): Promise<QueuedItemPublication> {
    const key = buildIdempotencyKey(
      `${DOCUMENT_IDEMPOTENCY_SCOPE}:${input.sourceSystem}`,
      docItem.correlationId,
    );

    const existing = this.idempotencyStore.get(key);
    if (existing) {
      logLifecycle("idempotency_hit", {
        requestId,
        jobId: existing.jobId,
        correlationId: docItem.correlationId,
        queueName: "send-document-message",
        batchId,
        batchIndex: index,
      });
      return existing;
    }

    const publication = await this.getOrCreateItemPublication(
      key,
      requestId,
      batchId,
      index,
      input,
      docItem,
      upload,
      authContext,
    );

    const eventName =
      publication.jobId === publication.jobId ? "idempotency_miss" : "idempotency_hit";
    logLifecycle(eventName, {
      requestId,
      jobId: publication.jobId,
      correlationId: docItem.correlationId,
      queueName: "send-document-message",
      batchId,
      batchIndex: index,
    });

    return publication;
  }

  private async getOrCreateItemPublication(
    key: string,
    requestId: string,
    batchId: string,
    index: number,
    input: PostMensagemDocumentoBatchInput,
    docItem: BatchDocumentItem,
    upload: DocumentUploadInput,
    authContext: MessageAuthContext,
  ): Promise<QueuedItemPublication> {
    const ongoing = this.inFlightPublications.get(key);
    if (ongoing) {
      return ongoing;
    }

    const publishPromise = this.enqueueNewItemPublication(
      requestId,
      batchId,
      index,
      input,
      docItem,
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

  private async enqueueNewItemPublication(
    requestId: string,
    batchId: string,
    index: number,
    input: PostMensagemDocumentoBatchInput,
    docItem: BatchDocumentItem,
    upload: DocumentUploadInput,
    authContext: MessageAuthContext,
  ): Promise<QueuedItemPublication> {
    const now = new Date().toISOString();
    const jobId = randomUUID();
    const filename = resolveFilename(docItem.filename, upload.originalFilename);

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
      correlationId: docItem.correlationId,
      requestId,
      document: buildDocumentAttachment(docItem, upload, storageRef),
    };

    await this.publisher(payload);

    logLifecycle("queued", {
      requestId,
      jobId,
      queueName: "send-document-message",
      tenantId: authContext.tenantId,
      apiKeyPrefix: authContext.apiKeyPrefix,
      metaPhoneNumberId: authContext.metaPhoneNumberId,
      batchId,
      batchIndex: index,
    });

    return {
      jobId,
      status: "queued",
      createdAt: now,
    };
  }
}
