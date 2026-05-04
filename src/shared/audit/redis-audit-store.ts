import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { env } from "../../config/env";
import type { LifecycleEvent, LifecycleFields } from "../logger/lifecycle-logger";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_MS = env.AUDIT_RETENTION_DAYS * DAY_IN_MS;
const AUDIT_RETENTION_SECONDS = Math.floor(AUDIT_RETENTION_MS / 1000);

type AuditEventPayload = {
  eventId: string;
  event: LifecycleEvent;
  ts: string;
  timestampMs: number;
  fields: LifecycleFields;
};

export class RedisAuditStore {
  private readonly redis: Redis;
  private readonly timelineKey: string;
  private readonly cleanupTimer: NodeJS.Timeout;

  public constructor() {
    this.redis = env.REDIS_URL
      ? new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: 1,
        })
      : new Redis({
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD,
          maxRetriesPerRequest: 1,
        });
    this.timelineKey = `${env.AUDIT_REDIS_PREFIX}:timeline`;
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredEvents().catch((error: unknown) => {
        console.error({
          event: "audit_cleanup_error",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, env.AUDIT_CLEANUP_INTERVAL_MS);

    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  public async recordLifecycleEvent(
    event: LifecycleEvent,
    fields: LifecycleFields,
  ): Promise<void> {
    const timestamp = new Date();
    const timestampMs = timestamp.getTime();
    const ts = timestamp.toISOString();
    const eventId = `${fields.jobId}:${timestampMs}:${randomUUID()}`;
    const payload: AuditEventPayload = {
      eventId,
      event,
      ts,
      timestampMs,
      fields,
    };

    const eventKey = this.buildEventKey(eventId);
    const jobKey = this.buildJobKey(fields.jobId);
    const statusAtual = this.resolveJobStatus(event);
    const flatEvent = this.toRedisHash({
      event: payload.event,
      ts: payload.ts,
      eventId: payload.eventId,
      timestampMs: payload.timestampMs,
      ...payload.fields,
    });
    const jobSummary = this.toRedisHash({
      jobId: fields.jobId,
      requestId: fields.requestId,
      queueName: fields.queueName,
      statusAtual,
      updatedAt: ts,
      lastReason: fields.reason,
      lastReasonCode: fields.reasonCode,
    });

    const pipeline = this.redis.pipeline();
    pipeline.zadd(this.timelineKey, String(timestampMs), eventId);
    pipeline.hset(eventKey, flatEvent);
    pipeline.expire(eventKey, AUDIT_RETENTION_SECONDS);
    pipeline.hset(jobKey, jobSummary);
    pipeline.expire(jobKey, AUDIT_RETENTION_SECONDS);
    await pipeline.exec();
  }

  public async cleanupExpiredEvents(): Promise<void> {
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    const expiredEventIds = await this.redis.zrangebyscore(
      this.timelineKey,
      0,
      cutoff,
      "LIMIT",
      0,
      1000,
    );

    if (expiredEventIds.length === 0) {
      return;
    }

    const pipeline = this.redis.pipeline();
    pipeline.zrem(this.timelineKey, ...expiredEventIds);
    for (const eventId of expiredEventIds) {
      pipeline.del(this.buildEventKey(eventId));
    }
    await pipeline.exec();
  }

  public async shutdown(): Promise<void> {
    clearInterval(this.cleanupTimer);
    await this.redis.quit();
  }

  private buildEventKey(eventId: string): string {
    return `${env.AUDIT_REDIS_PREFIX}:event:${eventId}`;
  }

  private buildJobKey(jobId: string): string {
    return `${env.AUDIT_REDIS_PREFIX}:job:${jobId}`;
  }

  private resolveJobStatus(event: LifecycleEvent): string {
    if (event === "success") {
      return "success";
    }
    if (event === "failed") {
      return "failed";
    }
    if (event === "dead_letter_published") {
      return "dead_letter";
    }
    if (event === "retry_scheduled") {
      return "retry_scheduled";
    }
    if (event === "processing") {
      return "processing";
    }
    if (event === "queued") {
      return "queued";
    }
    return event;
  }

  private toRedisHash(value: Record<string, unknown>): Record<string, string> {
    const output: Record<string, string> = {};
    for (const [key, field] of Object.entries(value)) {
      if (field === undefined || field === null) {
        continue;
      }
      output[key] = String(field);
    }
    return output;
  }
}

let auditStoreSingleton: RedisAuditStore | null = null;

export const initializeAuditStore = (): RedisAuditStore | null => {
  if (env.QUEUE_DRIVER !== "redis" || !env.AUDIT_ENABLED) {
    return null;
  }

  if (!auditStoreSingleton) {
    auditStoreSingleton = new RedisAuditStore();
  }

  return auditStoreSingleton;
};

export const getAuditStore = (): RedisAuditStore | null => {
  return auditStoreSingleton;
};

export const shutdownAuditStore = async (): Promise<void> => {
  if (!auditStoreSingleton) {
    return;
  }

  await auditStoreSingleton.shutdown();
  auditStoreSingleton = null;
};
