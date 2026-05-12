import { randomUUID } from "node:crypto";
import {
  Queue,
  Worker,
  type ConnectionOptions,
  type Job,
  type JobType,
} from "bullmq";
import type {
  DeadLetterJobPayload,
  DeadLetterReason,
  QueueConnection,
  QueueHandler,
  QueueJob,
  QueueName,
  QueueSnapshot,
} from "./queue-connection.interface";
import {
  isNonRetryableQueueError,
  isRetryableQueueError,
} from "./queue-errors";
import { logLifecycle } from "../logger/lifecycle-logger";
import { jobResultRegistry } from "../../modules/mensagens/job-result-registry";

const DEAD_LETTER_SUFFIX = "-dead-letter";
const SNAPSHOT_JOB_STATES: JobType[] = [
  "wait",
  "active",
  "delayed",
  "paused",
  "prioritized",
  "waiting-children",
];
const KNOWN_QUEUE_NAMES: QueueName[] = [
  "send-text-message",
  "send-text-message-dead-letter",
  "send-document-message",
  "send-document-message-dead-letter",
];

type RedisUrlConnectionInput = {
  url: string;
};

type RedisHostPortConnectionInput = {
  host: string;
  port: number;
  password?: string;
};

type RedisConnectionInput = RedisUrlConnectionInput | RedisHostPortConnectionInput;

type PayloadWithQueueMetadata = {
  jobId?: string;
  createdAt?: string;
};

const hasQueueMetadata = (
  payload: unknown,
): payload is PayloadWithQueueMetadata => {
  return typeof payload === "object" && payload !== null;
};

const buildDeadLetterQueueName = (queueName: QueueName): QueueName => {
  if (queueName.endsWith(DEAD_LETTER_SUFFIX)) {
    return queueName;
  }

  return `${queueName}${DEAD_LETTER_SUFFIX}` as QueueName;
};

export class RedisQueueConnection implements QueueConnection {
  private readonly queues = new Map<QueueName, Queue<unknown>>();
  private readonly handlers = new Map<QueueName, Set<QueueHandler<unknown>>>();
  private readonly workers = new Map<QueueName, Worker<unknown>>();
  private isShuttingDown = false;

  private readonly connection: ConnectionOptions;

  public constructor(
    redis: RedisConnectionInput,
    private readonly maxAttempts: number,
    private readonly deadLetterRetentionMs: number,
    private readonly queuePrefix: string,
  ) {
    if ("url" in redis) {
      this.connection = {
        url: redis.url,
        maxRetriesPerRequest: null,
      };
      return;
    }

    this.connection = {
      host: redis.host,
      port: redis.port,
      password: redis.password,
      maxRetriesPerRequest: null,
    };
  }

  public async publish<TPayload>(
    queueName: QueueName,
    payload: TPayload,
  ): Promise<QueueJob<TPayload>> {
    this.ensureActive();

    const queue = this.getQueue(queueName);
    const now = new Date().toISOString();
    const payloadMetadata: PayloadWithQueueMetadata = hasQueueMetadata(payload)
      ? payload
      : {};
    const jobId = payloadMetadata.jobId?.trim() || randomUUID();
    const createdAt = payloadMetadata.createdAt?.trim() || now;
    const queuedJob: QueueJob<TPayload> = {
      queueName,
      payload,
      metadata: {
        jobId,
        attempt: 1,
        createdAt,
        updatedAt: now,
      },
    };

    await queue.add(queueName, payload as unknown, {
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1,
    });

    const queueSize = await queue.count();
    console.info({
      event: "queue_publish",
      queueName,
      queueSize,
      jobId,
      attempt: 1,
      driver: "redis",
    });

    return queuedJob;
  }

  public async consume<TPayload>(
    queueName: QueueName,
    handler: QueueHandler<TPayload>,
  ): Promise<{ unsubscribe: () => void }> {
    this.ensureActive();
    this.getQueue(queueName);
    const typedHandlers = this.getHandlers(queueName);
    const internalHandler = handler as QueueHandler<unknown>;
    typedHandlers.add(internalHandler);

    if (!this.workers.has(queueName)) {
      const worker = new Worker(
        queueName,
        async (job) => {
          await this.processJob(queueName, job);
        },
        {
          connection: this.connection,
          prefix: this.queuePrefix,
          autorun: true,
          concurrency: 1,
        },
      );
      this.workers.set(queueName, worker);
    }

    return {
      unsubscribe: () => {
        typedHandlers.delete(internalHandler);
        if (typedHandlers.size === 0) {
          const worker = this.workers.get(queueName);
          if (worker) {
            void worker.close();
            this.workers.delete(queueName);
          }
        }
      },
    };
  }

  public async ack<TPayload>(job: QueueJob<TPayload>): Promise<void> {
    console.info({
      event: "queue_ack",
      queueName: job.queueName,
      jobId: job.metadata.jobId,
      attempt: job.metadata.attempt,
      driver: "redis",
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
        driver: "redis",
      });
      await this.deadLetter(job, reason);
      return;
    }

    const queue = this.getQueue(job.queueName);
    await queue.add(job.queueName, job.payload as unknown, {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 1,
      delay: Math.max(0, Math.floor(delayMs)),
    });

    const queueSize = await queue.count();
    console.warn({
      event: "queue_retry",
      queueName: job.queueName,
      jobId: job.metadata.jobId,
      attempt: nextAttempt,
      reason: reason.reason,
      reasonCode: reason.reasonCode,
      delayMs,
      queueSize,
      driver: "redis",
    });
  }

  public async deadLetter<TPayload>(
    job: QueueJob<TPayload>,
    reason: DeadLetterReason,
  ): Promise<void> {
    const deadLetterQueueName = buildDeadLetterQueueName(job.queueName);
    const deadLetterQueue = this.getQueue(deadLetterQueueName);
    const failedAt = new Date().toISOString();
    await this.purgeExpiredDeadLetters(deadLetterQueueName);

    const deadLetterPayload: DeadLetterJobPayload = {
      originalQueueName: job.queueName,
      failedAt,
      reason: reason.reason,
      reasonCode: reason.reasonCode,
      originalPayload: job.payload,
      originalMetadata: {
        ...job.metadata,
        updatedAt: failedAt,
        lastError: reason.reason,
      },
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

    await deadLetterQueue.add(deadLetterQueueName, deadLetterPayload, {
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1,
    });

    const deadLetterQueueSize = await deadLetterQueue.count();
    console.error({
      event: "queue_dead_letter",
      queueName: job.queueName,
      deadLetterQueueName,
      jobId: job.metadata.jobId,
      attempt: job.metadata.attempt,
      reason: reason.reason,
      reasonCode: reason.reasonCode,
      deadLetterQueueSize,
      driver: "redis",
    });
    logLifecycle("dead_letter_published", {
      requestId:
        typeof job.payload === "object" &&
        job.payload !== null &&
        "requestId" in job.payload
          ? String((job.payload as { requestId?: string }).requestId ?? "")
          : undefined,
      jobId: deadLetterJob.metadata.jobId,
      attempt: deadLetterJob.metadata.attempt,
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

  public async snapshot(): Promise<QueueSnapshot> {
    const queueNames = new Set<QueueName>([
      ...KNOWN_QUEUE_NAMES,
      ...Array.from(this.queues.keys()),
    ]);
    const entries = await Promise.all(
      Array.from(queueNames).map(async (queueName) => {
        const queue = this.getQueue(queueName);
        const jobs = await queue.getJobs(SNAPSHOT_JOB_STATES);
        const mappedJobs = jobs.map((job) =>
          this.mapBullJobToQueueJob(queueName, job),
        );
        return [queueName, mappedJobs] as const;
      }),
    );

    return Object.fromEntries(entries) as QueueSnapshot;
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    for (const worker of this.workers.values()) {
      await worker.close();
    }
    for (const queue of this.queues.values()) {
      await queue.close();
    }

    this.workers.clear();
    this.handlers.clear();
    this.queues.clear();

    console.info({
      event: "queue_shutdown",
      driver: "redis",
    });
  }

  private async processJob(
    queueName: QueueName,
    bullJob: Job<unknown>,
  ): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    const handlers = this.handlers.get(queueName);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const queueJob = this.mapBullJobToQueueJob(queueName, bullJob);
    for (const handler of handlers) {
      try {
        await handler(queueJob);
        await this.ack(queueJob);
      } catch (error: unknown) {
        if (isNonRetryableQueueError(error)) {
          await this.deadLetter(queueJob, {
            reason: error.message,
            reasonCode: error.reasonCode,
          });
          return;
        }

        const delayMs = isRetryableQueueError(error) ? error.delayMs : 0;
        const reasonCode = isRetryableQueueError(error)
          ? error.reasonCode
          : undefined;
        const reason = error instanceof Error ? error.message : String(error);
        await this.retry(queueJob, { reason, reasonCode }, delayMs);
        return;
      }
    }
  }

  private mapBullJobToQueueJob(
    queueName: QueueName,
    job: Job<unknown>,
  ): QueueJob<unknown> {
    const now = new Date().toISOString();
    const payloadMetadata: PayloadWithQueueMetadata = hasQueueMetadata(job.data)
      ? job.data
      : {};
    const createdAt =
      payloadMetadata.createdAt?.trim() ||
      new Date(job.timestamp).toISOString();
    const jobId =
      payloadMetadata.jobId?.trim() || String(job.id ?? randomUUID());
    const attempt = Math.max(1, job.attemptsMade + 1);

    return {
      queueName,
      payload: job.data,
      metadata: {
        jobId,
        attempt,
        createdAt,
        updatedAt: now,
        lastError: job.failedReason || undefined,
      },
    };
  }

  private getQueue(queueName: QueueName): Queue<unknown> {
    const existing = this.queues.get(queueName);
    if (existing) {
      return existing;
    }

    const queue = new Queue(queueName, {
      connection: this.connection,
      prefix: this.queuePrefix,
    });
    this.queues.set(queueName, queue);
    return queue;
  }

  private getHandlers(queueName: QueueName): Set<QueueHandler<unknown>> {
    const existing = this.handlers.get(queueName);
    if (existing) {
      return existing;
    }

    const created = new Set<QueueHandler<unknown>>();
    this.handlers.set(queueName, created);
    return created;
  }

  private ensureActive(): void {
    if (this.isShuttingDown) {
      throw new Error("Queue connection is shutting down");
    }
  }

  private async purgeExpiredDeadLetters(queueName: QueueName): Promise<void> {
    const queue = this.getQueue(queueName);
    const jobs = await queue.getJobs(SNAPSHOT_JOB_STATES);
    const now = Date.now();
    const retentionMs = this.deadLetterRetentionMs;

    for (const job of jobs) {
      const createdAt = hasQueueMetadata(job.data)
        ? job.data.createdAt
        : undefined;
      const createdAtTs = createdAt ? Date.parse(createdAt) : job.timestamp;
      if (Number.isNaN(createdAtTs)) {
        continue;
      }

      if (createdAtTs + retentionMs <= now) {
        await job.remove();
      }
    }
  }
}
