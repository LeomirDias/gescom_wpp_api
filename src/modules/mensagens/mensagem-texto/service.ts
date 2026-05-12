import { randomUUID } from "node:crypto";
import { env } from "../../../config/env";
import type { MessageAuthContext } from "../../../shared/middleware/auth-api-key";
import type { SendTextMessageJobPayload } from "../../../shared/queue/queue-connection.interface";
import { logLifecycle } from "../../../shared/logger/lifecycle-logger";
import type { ApiErrorDetails } from "../../../shared/errors/api-error-response";
import {
  ConflictError,
  GatewayTimeoutError,
  IdempotencyReplayError,
  SendFailedError,
} from "../../../shared/errors/app-error";
import {
  buildTenantMessageIdempotencyKey,
  InMemoryIdempotencyStore,
} from "../idempotency-store";
import { fingerprintMensagemTexto } from "../idempotency-payload";
import { jobResultRegistry } from "../job-result-registry";
import type { PostMensagemTextoInput, PostMensagemTextoSentOutput } from "./schema";
import { publishSendTextMessage } from "./queue";
import type { SendTextMessageResult } from "./mapper";

type CachedPublication = {
  jobId: string;
  status: "sent";
  createdAt: string;
  waMessageId: string;
  waContactId: string;
};

type TextIdempotencyEntry = {
  fingerprint: string;
  publication: CachedPublication;
};

type InFlightTextPublication = {
  fingerprint: string;
  promise: Promise<CachedPublication>;
};

const publicationReplayDetails = (p: CachedPublication): ApiErrorDetails => [
  { path: "jobId", message: p.jobId },
  { path: "createdAt", message: p.createdAt },
  { path: "waMessageId", message: p.waMessageId },
  { path: "waContactId", message: p.waContactId },
];

const IDEMPOTENCY_MISMATCH_MESSAGE =
  "O mesmo correlationId ja foi utilizado com conteudo distinto (to ou message)";

export class MensagensService {
  private readonly inFlightPublications = new Map<string, InFlightTextPublication>();

  public constructor(
    private readonly publisher: (
      payload: SendTextMessageJobPayload,
    ) => Promise<unknown> = publishSendTextMessage,
    private readonly idempotencyStore = new InMemoryIdempotencyStore<TextIdempotencyEntry>(
      env.IDEMPOTENCY_TTL_MS,
      env.IDEMPOTENCY_CLEANUP_INTERVAL_MS,
    ),
  ) {}

  public async enfileirarMensagemTexto(
    requestId: string,
    input: PostMensagemTextoInput,
    authContext: MessageAuthContext,
  ): Promise<PostMensagemTextoSentOutput> {
    const fingerprint = fingerprintMensagemTexto(input);
    const key = buildTenantMessageIdempotencyKey(
      authContext.tenantId,
      "text",
      input.sourceSystem,
      input.correlationId,
    );

    const existing = this.idempotencyStore.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ConflictError(IDEMPOTENCY_MISMATCH_MESSAGE, "IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      logLifecycle("idempotency_hit", {
        requestId,
        jobId: existing.publication.jobId,
        correlationId: input.correlationId,
      });
      throw new IdempotencyReplayError(publicationReplayDetails(existing.publication));
    }

    const publication = await this.getOrCreatePublication(
      key,
      fingerprint,
      requestId,
      input,
      authContext,
    );

    logLifecycle("idempotency_miss", {
      requestId,
      jobId: publication.jobId,
      correlationId: input.correlationId,
    });

    return { requestId, ...publication };
  }

  private async getOrCreatePublication(
    key: string,
    fingerprint: string,
    requestId: string,
    input: PostMensagemTextoInput,
    authContext: MessageAuthContext,
  ): Promise<CachedPublication> {
    const ongoing = this.inFlightPublications.get(key);
    if (ongoing) {
      if (ongoing.fingerprint !== fingerprint) {
        throw new ConflictError(IDEMPOTENCY_MISMATCH_MESSAGE, "IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      return ongoing.promise;
    }

    const publishPromise = this.processNewPublication(
      requestId,
      input,
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

  private async processNewPublication(
    requestId: string,
    input: PostMensagemTextoInput,
    authContext: MessageAuthContext,
  ): Promise<CachedPublication> {
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

    const outcomePromise = jobResultRegistry.register<SendTextMessageResult>(
      jobId,
      env.SYNC_SEND_TIMEOUT_MS,
    );

    await this.publisher(payload);

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
      throw new GatewayTimeoutError();
    }

    throw new SendFailedError(outcome.reason, outcome.reasonCode);
  }
}
