import { getAuditStore } from "../audit/redis-audit-store";

/**
 * Helper para logs de lifecycle do fluxo de envio de mensagem.
 * Formato unico permite reconstruir o ciclo completo por `requestId`/`jobId`.
 */

export type LifecycleEvent =
  | "queued"
  | "processing"
  | "success"
  | "failed"
  | "retry_scheduled"
  | "idempotency_hit"
  | "idempotency_miss"
  | "dead_letter_published";

export type LifecycleFields = {
  requestId?: string;
  jobId: string;
  attempt?: number;
  durationMs?: number;
  delayMs?: number;
  reason?: string;
  reasonCode?: string;
  waMessageId?: string;
  waContactId?: string;
  queueName?: string;
  [key: string]: unknown;
};

const logForEvent: Record<LifecycleEvent, (payload: Record<string, unknown>) => void> = {
  queued: (payload) => console.info(payload),
  processing: (payload) => console.info(payload),
  success: (payload) => console.info(payload),
  retry_scheduled: (payload) => console.warn(payload),
  idempotency_hit: (payload) => console.info(payload),
  idempotency_miss: (payload) => console.info(payload),
  dead_letter_published: (payload) => console.error(payload),
  failed: (payload) => console.error(payload),
};

export const logLifecycle = (event: LifecycleEvent, fields: LifecycleFields): void => {
  const payload: Record<string, unknown> = {
    event: `lifecycle_${event}`,
    ts: new Date().toISOString(),
    ...fields,
  };

  logForEvent[event](payload);

  const auditStore = getAuditStore();
  if (!auditStore) {
    return;
  }

  void auditStore.recordLifecycleEvent(event, fields).catch((error: unknown) => {
    console.error({
      event: "audit_write_error",
      lifecycleEvent: event,
      jobId: fields.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};
