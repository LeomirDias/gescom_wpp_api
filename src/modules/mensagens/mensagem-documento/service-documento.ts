import { randomUUID } from "node:crypto";
import { env } from "../../../config/env";
import type { MessageAuthContext } from "../../../shared/middleware/auth-api-key";
import type {
  DocumentJobAttachment,
  SendDocumentMessageJobPayload,
} from "../../../shared/queue/queue-connection.interface";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";

import type { PostMensagemDocumentoInput } from "./schema-documento";
import { publishSendDocumentMessage } from "./queue-documento";
import {
  buildIdempotencyKey,
  InMemoryIdempotencyStore,
} from "../idempotency-store";

type QueuePublication = {
  requestId: string;
  jobId: string;
  status: "queued";
  createdAt: string;
};

const DOCUMENT_IDEMPOTENCY_SCOPE = "document";

const buildDocumentAttachment = (
  input: PostMensagemDocumentoInput,
): DocumentJobAttachment => {
  const { document } = input;

  const attachment: DocumentJobAttachment = {
    path: document.path,
    caption: document.caption,
  };
  if (document.filename) {
    attachment.filename = document.filename;
  }

  return attachment;
};

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
  ) {}

  public async enfileirarMensagemDocumento(
    requestId: string,
    input: PostMensagemDocumentoInput,
    authContext: MessageAuthContext,
  ): Promise<QueuePublication> {
    if (!input.correlationId) {
      return this.enqueueNewPublication(requestId, input, authContext);
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
    authContext: MessageAuthContext,
  ): Promise<QueuePublication> {
    const ongoing = this.inFlightPublications.get(key);
    if (ongoing) {
      return ongoing;
    }

    const publishPromise = this.enqueueNewPublication(requestId, input, authContext);
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
    authContext: MessageAuthContext,
  ): Promise<QueuePublication> {
    const now = new Date().toISOString();
    const jobId = randomUUID();
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
      document: buildDocumentAttachment(input),
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
