import { randomUUID } from "node:crypto";
import { env } from "../../../config/env";
import type { MessageAuthContext } from "../../../shared/middleware/auth-api-key";
import type {
  DocumentJobAttachment,
  DocumentStorageRef,
  SendDocumentMessageJobPayload,
} from "../../../shared/queue/queue-connection.interface";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";
import type { ApiErrorDetails } from "../../../shared/errors/api-error-response";
import { AppError, ConflictError, IdempotencyReplayError } from "../../../shared/errors/app-error";
import { fingerprintMensagemDocumentoItem } from "../idempotency-payload";

import type {
  BatchDocumentItem,
  BatchFailedItem,
  BatchSentItem,
  BatchResponseItem,
  PostMensagemDocumentoBatchInput,
  PostMensagemDocumentoBatchOutput,
} from "./schema-documento";
import { publishSendDocumentMessage } from "./queue-documento";
import {
  buildTenantMessageIdempotencyKey,
  InMemoryIdempotencyStore,
} from "../idempotency-store";
import {
  uploadDocumentBuffer as defaultUploadDocumentBuffer,
} from "./storage-documento";
import { jobResultRegistry } from "../job-result-registry";
import type { SendDocumentMessageResult } from "./mapper-documento";

export type DocumentUploadInput = {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
};

type SentItemPublication = {
  jobId: string;
  status: "sent";
  createdAt: string;
  waMessageId: string;
  waContactId: string;
};

type DocumentIdempotencyEntry = {
  fingerprint: string;
  publication: SentItemPublication;
};

type InFlightDocumentPublication = {
  fingerprint: string;
  promise: Promise<SentItemPublication>;
};

const DOCUMENT_IDEMPOTENCY_MISMATCH_MESSAGE =
  "O mesmo correlationId ja foi utilizado com documento ou metadados distintos";

const isIdempotencyClientFailure = (reason: unknown): reason is AppError =>
  reason instanceof AppError &&
  (reason.code === "IDEMPOTENCY_REPLAY" || reason.code === "IDEMPOTENCY_PAYLOAD_MISMATCH");

const publicationReplayDetails = (p: SentItemPublication): ApiErrorDetails => [
  { path: "jobId", message: p.jobId },
  { path: "createdAt", message: p.createdAt },
  { path: "waMessageId", message: p.waMessageId },
  { path: "waContactId", message: p.waContactId },
];

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
  item: BatchDocumentItem,
  upload: DocumentUploadInput,
  storageRef: DocumentStorageRef,
): DocumentJobAttachment => ({
  caption: item.caption,
  filename: resolveFilename(item.filename, upload.originalFilename),
  storage: storageRef,
});

class DocumentItemFailure extends Error {
  public readonly reasonCode?: string;

  public constructor(reason: string, reasonCode?: string) {
    super(reason);
    this.name = "DocumentItemFailure";
    this.reasonCode = reasonCode;
  }
}

export class MensagensDocumentoService {
  private readonly inFlightPublications = new Map<string, InFlightDocumentPublication>();

  public constructor(
    private readonly publisher: (
      payload: SendDocumentMessageJobPayload,
    ) => Promise<unknown> = publishSendDocumentMessage,
    private readonly idempotencyStore = new InMemoryIdempotencyStore<DocumentIdempotencyEntry>(
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
  ): Promise<PostMensagemDocumentoBatchOutput> {
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

    for (const result of itemResults) {
      if (result.status === "rejected" && isIdempotencyClientFailure(result.reason)) {
        throw result.reason;
      }
    }

    const items: BatchResponseItem[] = itemResults.map((result, index) => {
      const docItem = input.documents[index];
      if (result.status === "fulfilled") {
        const sentItem: BatchSentItem = {
          index,
          correlationId: docItem.correlationId,
          jobId: result.value.jobId,
          status: "sent",
          createdAt: result.value.createdAt,
          waMessageId: result.value.waMessageId,
          waContactId: result.value.waContactId,
          ...(docItem.clientFileKey !== undefined
            ? { clientFileKey: docItem.clientFileKey }
            : {}),
        };
        return sentItem;
      }

      const failure = result.reason;
      const reason =
        failure instanceof Error ? failure.message : String(failure);
      const reasonCode =
        failure instanceof DocumentItemFailure ? failure.reasonCode : undefined;
      const failedItem: BatchFailedItem = {
        index,
        correlationId: docItem.correlationId,
        status: "failed",
        error: reason,
        ...(reasonCode ? { errorCode: reasonCode } : {}),
        ...(docItem.clientFileKey !== undefined
          ? { clientFileKey: docItem.clientFileKey }
          : {}),
      };
      return failedItem;
    });

    const totalSent = items.filter((item) => item.status === "sent").length;
    const totalFailed = items.filter((item) => item.status === "failed").length;

    return {
      requestId,
      batchId,
      totalSent,
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
  ): Promise<SentItemPublication> {
    const resolvedFilename = resolveFilename(docItem.filename, upload.originalFilename);
    const fingerprint = fingerprintMensagemDocumentoItem(
      input.to,
      docItem.caption,
      resolvedFilename,
      upload.buffer,
    );
    const key = buildTenantMessageIdempotencyKey(
      authContext.tenantId,
      "document",
      input.sourceSystem,
      docItem.correlationId,
    );

    const existing = this.idempotencyStore.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ConflictError(
          DOCUMENT_IDEMPOTENCY_MISMATCH_MESSAGE,
          "IDEMPOTENCY_PAYLOAD_MISMATCH",
        );
      }
      logLifecycle("idempotency_hit", {
        requestId,
        jobId: existing.publication.jobId,
        correlationId: docItem.correlationId,
        queueName: "send-document-message",
        batchId,
        batchIndex: index,
      });
      throw new IdempotencyReplayError(publicationReplayDetails(existing.publication));
    }

    const publication = await this.getOrCreateItemPublication(
      key,
      fingerprint,
      requestId,
      batchId,
      index,
      input,
      docItem,
      upload,
      authContext,
    );

    logLifecycle("idempotency_miss", {
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
    fingerprint: string,
    requestId: string,
    batchId: string,
    index: number,
    input: PostMensagemDocumentoBatchInput,
    docItem: BatchDocumentItem,
    upload: DocumentUploadInput,
    authContext: MessageAuthContext,
  ): Promise<SentItemPublication> {
    const ongoing = this.inFlightPublications.get(key);
    if (ongoing) {
      if (ongoing.fingerprint !== fingerprint) {
        throw new ConflictError(
          DOCUMENT_IDEMPOTENCY_MISMATCH_MESSAGE,
          "IDEMPOTENCY_PAYLOAD_MISMATCH",
        );
      }
      return ongoing.promise;
    }

    const publishPromise = this.processNewItemPublication(
      requestId,
      batchId,
      index,
      input,
      docItem,
      upload,
      authContext,
    );
    this.inFlightPublications.set(key, { fingerprint, promise: publishPromise });

    try {
      const publication = await publishPromise;
      this.idempotencyStore.set(key, { fingerprint, publication });
      return publication;
    } finally {
      this.inFlightPublications.delete(key);
    }
  }

  private async processNewItemPublication(
    requestId: string,
    batchId: string,
    index: number,
    input: PostMensagemDocumentoBatchInput,
    docItem: BatchDocumentItem,
    upload: DocumentUploadInput,
    authContext: MessageAuthContext,
  ): Promise<SentItemPublication> {
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

    const outcomePromise = jobResultRegistry.register<SendDocumentMessageResult>(
      jobId,
      env.SYNC_SEND_TIMEOUT_MS,
    );

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

    const outcome = await outcomePromise;

    if (outcome.type === "success") {
      return {
        jobId,
        status: "sent",
        createdAt: now,
        waMessageId: outcome.data.waMessageId,
        waContactId: outcome.data.waContactId,
      };
    }

    if (outcome.type === "timeout") {
      throw new DocumentItemFailure(
        "Envio nao concluido no tempo limite",
        "send_timeout",
      );
    }

    throw new DocumentItemFailure(outcome.reason, outcome.reasonCode);
  }
}
