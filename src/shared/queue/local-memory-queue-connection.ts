import { randomUUID } from "node:crypto";
import type {
  DeadLetterJobPayload,
  DeadLetterReason,
  QueueConnection,
  QueueHandler,
  QueueJob,
  QueueName,
  QueueSnapshot,
  QueueSubscription,
} from "./queue-connection.interface";
import {
  isNonRetryableQueueError,
  isRetryableQueueError,
} from "./queue-errors";
import { logLifecycle } from "../logger/lifecycle-logger";
import { jobResultRegistry } from "../../modules/mensagens/job-result-registry";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DEAD_LETTER_RETENTION_MS = 86_400_000;
const DEAD_LETTER_SUFFIX = "-dead-letter";

const buildDeadLetterQueueName = (queueName: QueueName): QueueName => {
  if (queueName.endsWith(DEAD_LETTER_SUFFIX)) {
    return queueName;
  }

  return `${queueName}${DEAD_LETTER_SUFFIX}` as QueueName;
};

type PayloadWithQueueMetadata = {
  jobId?: string;
  createdAt?: string;
};

const hasQueueMetadata = (payload: unknown): payload is PayloadWithQueueMetadata => {
  return typeof payload === "object" && payload !== null;
};

export class LocalMemoryQueueConnection implements QueueConnection {
  private readonly queueStore = new Map<QueueName, Array<QueueJob<unknown>>>();
  private readonly handlers = new Map<QueueName, Set<QueueHandler<unknown>>>();
  private readonly processingQueues = new Set<QueueName>();
  private readonly pendingRetries = new Set<NodeJS.Timeout>();
  private isShuttingDown = false;

  public constructor(
    private readonly maxAttempts = DEFAULT_MAX_ATTEMPTS,
    private readonly deadLetterRetentionMs = DEFAULT_DEAD_LETTER_RETENTION_MS,
  ) {}

  public async publish<TPayload>(
    queueName: QueueName,
    payload: TPayload,
  ): Promise<QueueJob<TPayload>> {
    this.ensureActive();

    const now = new Date().toISOString();
    const payloadMetadata: PayloadWithQueueMetadata = hasQueueMetadata(payload) ? payload : {};
    const jobId = payloadMetadata.jobId?.trim() || randomUUID();
    const createdAt = payloadMetadata.createdAt?.trim() || now;
    const job: QueueJob<TPayload> = {
      queueName,
      payload,
      metadata: {
        jobId,
        attempt: 1,
        createdAt,
        updatedAt: now,
      },
    };

    const queue = this.getQueue(queueName);
    queue.push(job as QueueJob<unknown>);

    console.info({
      event: "queue_publish",
      queueName,
      queueSize: queue.length,
      jobId: job.metadata.jobId,
      attempt: job.metadata.attempt,
    });

    this.scheduleProcess(queueName);
    return job;
  }

  public async consume<TPayload>(
    queueName: QueueName,
    handler: QueueHandler<TPayload>,
  ): Promise<QueueSubscription> {
    this.ensureActive();

    const typedHandlers = this.getHandlers(queueName);
    const internalHandler = handler as QueueHandler<unknown>;

    typedHandlers.add(internalHandler);
    this.scheduleProcess(queueName);

    return {
      unsubscribe: () => {
        typedHandlers.delete(internalHandler);
      },
    };
  }

  public async ack<TPayload>(job: QueueJob<TPayload>): Promise<void> {
    console.info({
      event: "queue_ack",
      queueName: job.queueName,
      jobId: job.metadata.jobId,
      attempt: job.metadata.attempt,
    });
  }

  public async retry<TPayload>(
    job: QueueJob<TPayload>,
    reason: DeadLetterReason,
    delayMs = 0,
  ): Promise<void> {
    const nextAttempt = job.metadata.attempt + 1;

    if (nextAttempt > this.maxAttempts) {
      console.error({
        event: "queue_retry_exhausted",
        queueName: job.queueName,
        jobId: job.metadata.jobId,
        attempt: job.metadata.attempt,
        reason: reason.reason,
        reasonCode: reason.reasonCode,
      });
      await this.deadLetter(job, reason);
      return;
    }

    const now = new Date().toISOString();
    const retryJob: QueueJob<TPayload> = {
      ...job,
      metadata: {
        ...job.metadata,
        attempt: nextAttempt,
        updatedAt: now,
        lastError: reason.reason,
      },
    };

    const enqueueRetry = () => {
      if (this.isShuttingDown) {
        return;
      }

      const queue = this.getQueue(retryJob.queueName);
      queue.push(retryJob as QueueJob<unknown>);

      console.warn({
        event: "queue_retry",
        queueName: retryJob.queueName,
        jobId: retryJob.metadata.jobId,
        attempt: retryJob.metadata.attempt,
        reason: reason.reason,
        reasonCode: reason.reasonCode,
        delayMs,
        queueSize: queue.length,
      });

      this.scheduleProcess(retryJob.queueName);
    };

    if (delayMs > 0) {
      const timer: NodeJS.Timeout = setTimeout(() => {
        this.pendingRetries.delete(timer);
        enqueueRetry();
      }, delayMs);

      if (typeof timer.unref === "function") {
        timer.unref();
      }

      this.pendingRetries.add(timer);
      return;
    }

    enqueueRetry();
  }

  public async deadLetter<TPayload>(
    job: QueueJob<TPayload>,
    reason: DeadLetterReason,
  ): Promise<void> {
    this.purgeExpiredDeadLetters();

    const deadLetterQueueName = buildDeadLetterQueueName(job.queueName);
    const failedAt = new Date().toISOString();
    const deadLetterPayload: DeadLetterJobPayload = {
      originalQueueName: job.queueName,
      failedAt,
      reason: reason.reason,
      reasonCode: reason.reasonCode,
      originalPayload: job.payload,
      originalMetadata: { ...job.metadata, updatedAt: failedAt, lastError: reason.reason },
    };
    const deadLetterJob: QueueJob<DeadLetterJobPayload> = {
      queueName: deadLetterQueueName,
      payload: deadLetterPayload,
      metadata: {
        jobId: job.metadata.jobId,
        attempt: job.metadata.attempt,
        createdAt: job.metadata.createdAt,
        updatedAt: failedAt,
        lastError: reason.reason,
      },
    };

    const queue = this.getQueue(deadLetterQueueName);
    queue.push(deadLetterJob as QueueJob<unknown>);

    console.error({
      event: "queue_dead_letter",
      queueName: job.queueName,
      deadLetterQueueName,
      jobId: job.metadata.jobId,
      attempt: job.metadata.attempt,
      reason: reason.reason,
      reasonCode: reason.reasonCode,
      deadLetterQueueSize: queue.length,
    });
    logLifecycle("dead_letter_published", {
      requestId:
        typeof job.payload === "object" &&
        job.payload !== null &&
        "requestId" in job.payload
          ? String((job.payload as { requestId?: string }).requestId ?? "")
          : undefined,
      jobId: job.metadata.jobId,
      attempt: job.metadata.attempt,
      queueName: job.queueName,
      reason: reason.reason,
      reasonCode: reason.reasonCode,
    });

    jobResultRegistry.rejectFailure(
      job.metadata.jobId,
      reason.reason,
      reason.reasonCode,
    );
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    for (const timer of this.pendingRetries) {
      clearTimeout(timer);
    }
    this.pendingRetries.clear();
    this.queueStore.clear();
    this.handlers.clear();
    this.processingQueues.clear();

    console.info({
      event: "queue_shutdown",
      driver: "memory",
    });
  }

  public async snapshot(): Promise<QueueSnapshot> {
    const entries = Array.from(this.queueStore.entries()).map(([queueName, jobs]) => [
      queueName,
      jobs.map((job) => ({ ...job })),
    ]);

    return Object.fromEntries(entries) as QueueSnapshot;
  }

  private ensureActive(): void {
    if (this.isShuttingDown) {
      throw new Error("Queue connection is shutting down");
    }
  }

  private getQueue(queueName: QueueName): Array<QueueJob<unknown>> {
    if (!this.queueStore.has(queueName)) {
      this.queueStore.set(queueName, []);
    }

    return this.queueStore.get(queueName) ?? [];
  }

  private getHandlers(queueName: QueueName): Set<QueueHandler<unknown>> {
    if (!this.handlers.has(queueName)) {
      this.handlers.set(queueName, new Set<QueueHandler<unknown>>());
    }

    return this.handlers.get(queueName) ?? new Set<QueueHandler<unknown>>();
  }

  private scheduleProcess(queueName: QueueName): void {
    if (this.processingQueues.has(queueName)) {
      return;
    }

    this.processingQueues.add(queueName);
    queueMicrotask(() => {
      this.processQueue(queueName).catch((error: unknown) => {
        console.error({
          event: "queue_process_error",
          queueName,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  private async processQueue(queueName: QueueName): Promise<void> {
    let hadHandlers = false;

    try {
      const queue = this.getQueue(queueName);
      const queueHandlers = Array.from(this.getHandlers(queueName));

      if (queueHandlers.length === 0) {
        return;
      }

      hadHandlers = true;

      while (queue.length > 0 && !this.isShuttingDown) {
        const queuedJob = queue.shift();
        if (!queuedJob) {
          continue;
        }

        console.info({
          event: "queue_consume",
          queueName,
          jobId: queuedJob.metadata.jobId,
          attempt: queuedJob.metadata.attempt,
          queueSize: queue.length,
        });

        const currentJob = queuedJob as QueueJob<unknown>;
        const handler = queueHandlers[0];

        try {
          await handler(currentJob);
          await this.ack(currentJob);
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);

          if (isNonRetryableQueueError(error)) {
            await this.deadLetter(currentJob, {
              reason,
              reasonCode: error.reasonCode,
            });
            continue;
          }

          const delayMs = isRetryableQueueError(error) ? error.delayMs : 0;
          const reasonCode = isRetryableQueueError(error) ? error.reasonCode : undefined;
          await this.retry(
            currentJob,
            {
              reason,
              reasonCode,
            },
            delayMs,
          );
        }
      }
    } finally {
      this.processingQueues.delete(queueName);

      // Só reagenda se havia consumidores nesta rodada; caso contrário, os jobs
      // ficam aguardando na fila até que um handler seja inscrito via `consume`,
      // evitando um loop de microtasks que starva o event loop.
      if (
        hadHandlers &&
        this.getQueue(queueName).length > 0 &&
        this.getHandlers(queueName).size > 0 &&
        !this.isShuttingDown
      ) {
        this.scheduleProcess(queueName);
      }
    }
  }

  private purgeExpiredDeadLetters(): void {
    const minFailedAtMs = Date.now() - this.deadLetterRetentionMs;

    for (const [queueName, queueJobs] of this.queueStore.entries()) {
      if (!queueName.endsWith(DEAD_LETTER_SUFFIX) || queueJobs.length === 0) {
        continue;
      }

      const keptJobs = queueJobs.filter((job) => {
        if (job.queueName !== queueName) {
          return true;
        }

        const payload = job.payload as DeadLetterJobPayload;
        const failedAtMs = Date.parse(payload.failedAt);
        return Number.isNaN(failedAtMs) || failedAtMs >= minFailedAtMs;
      });

      this.queueStore.set(queueName, keptJobs);
    }
  }
}
