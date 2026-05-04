import { randomUUID } from "node:crypto";
import { env } from "../../../config/env";
import type { MessageAuthContext } from "../../../shared/middleware/auth-api-key";
import type { SendTextMessageJobPayload } from "../../../shared/queue/queue-connection.interface";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";
import {
  buildIdempotencyKey,
  InMemoryIdempotencyStore,
} from "../idempotency-store";
import type { PostMensagemTextoInput } from "./schema";
import { publishSendTextMessage } from "./queue";

type QueuePublication = {
  requestId: string;
  jobId: string;
  status: "queued";
  createdAt: string;
};

export class MensagensService {
  private readonly inFlightPublications = new Map<
    string,
    Promise<QueuePublication>
  >();

  public constructor(
    private readonly publisher: (
      payload: SendTextMessageJobPayload,
    ) => Promise<unknown> = publishSendTextMessage,
    private readonly idempotencyStore = new InMemoryIdempotencyStore<QueuePublication>(
      env.IDEMPOTENCY_TTL_MS,
      env.IDEMPOTENCY_CLEANUP_INTERVAL_MS,
    ),
  ) {}

  public async enfileirarMensagemTexto(
    requestId: string,
    input: PostMensagemTextoInput,
    authContext: MessageAuthContext,
  ): Promise<QueuePublication> {
    if (!input.correlationId) {
      return this.enqueueNewPublication(requestId, input, authContext);
    }

    const key = buildIdempotencyKey(input.sourceSystem, input.correlationId);
    const existing = this.idempotencyStore.get(key);
    if (existing) {
      logLifecycle("idempotency_hit", {
        requestId,
        jobId: existing.jobId,
        correlationId: input.correlationId,
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
    });
    return output;
  }

  private async getOrCreatePublication(
    key: string,
    requestId: string,
    input: PostMensagemTextoInput,
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
    input: PostMensagemTextoInput,
    authContext: MessageAuthContext,
  ): Promise<QueuePublication> {
    const now = new Date().toISOString();
    const jobId = randomUUID();
    const payload: SendTextMessageJobPayload = {
      jobId,
      createdAt: now,
      tenantId: authContext.tenantId,
      apiKeyPrefix: authContext.apiKeyPrefix,
      metaPhoneNumberId: authContext.metaPhoneNumberId,
      to: input.to,
      message: input.message,
      sourceSystem: input.sourceSystem,
      correlationId: input.correlationId,
      requestId,
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
