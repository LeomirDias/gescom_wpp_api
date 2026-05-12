/**
 * Registry in-process que conecta o ciclo HTTP sincrono ao worker assincrono.
 *
 * Fluxo:
 *  - service `register(jobId, timeoutMs)` antes de publicar o job na fila e
 *    aguarda a Promise resultante;
 *  - worker chama `resolveSuccess(jobId, data)` apos o envio bem sucedido na
 *    Meta;
 *  - implementacao da fila chama `rejectFailure(jobId, reason)` no metodo
 *    `deadLetter`, cobrindo tanto NonRetryable direto quanto retries esgotados;
 *  - se nenhum dos dois ocorrer no tempo limite, o timer interno resolve com
 *    `timeout`.
 *
 * O registry e in-memory, suficiente enquanto API HTTP e workers rodam no
 * mesmo processo (ver `src/server.ts`). Caso sejam separados, migrar para
 * BullMQ `QueueEvents.waitUntilFinished()`.
 */

export type JobOutcome<TData> =
  | { type: "success"; data: TData }
  | { type: "failure"; reason: string; reasonCode?: string }
  | { type: "timeout" };

type PendingEntry = {
  resolve: (outcome: JobOutcome<unknown>) => void;
  timer: NodeJS.Timeout;
};

export class JobResultRegistry {
  private readonly pending = new Map<string, PendingEntry>();

  public register<TData>(jobId: string, timeoutMs: number): Promise<JobOutcome<TData>> {
    return new Promise<JobOutcome<TData>>((resolve) => {
      const existing = this.pending.get(jobId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.resolve({ type: "timeout" });
        this.pending.delete(jobId);
      }

      const timer: NodeJS.Timeout = setTimeout(() => {
        this.pending.delete(jobId);
        resolve({ type: "timeout" });
      }, Math.max(0, Math.floor(timeoutMs)));

      if (typeof timer.unref === "function") {
        timer.unref();
      }

      this.pending.set(jobId, {
        resolve: resolve as (outcome: JobOutcome<unknown>) => void,
        timer,
      });
    });
  }

  public resolveSuccess<TData>(jobId: string, data: TData): void {
    const entry = this.pending.get(jobId);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(jobId);
    entry.resolve({ type: "success", data });
  }

  public rejectFailure(jobId: string, reason: string, reasonCode?: string): void {
    const entry = this.pending.get(jobId);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(jobId);
    entry.resolve({ type: "failure", reason, reasonCode });
  }

  public clear(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve({ type: "timeout" });
    }
    this.pending.clear();
  }
}

export const jobResultRegistry = new JobResultRegistry();
