type IdempotencyEntry<TResponse> = {
  response: TResponse;
  expiresAt: number;
};

type GetNow = () => number;

const normalizeKeyPart = (value: string): string => value.trim().toLowerCase();

export const buildIdempotencyKey = (
  sourceSystem: string,
  correlationId: string,
): string => {
  return `${normalizeKeyPart(sourceSystem)}:${normalizeKeyPart(correlationId)}`;
};

export class InMemoryIdempotencyStore<TResponse> {
  private readonly entries = new Map<string, IdempotencyEntry<TResponse>>();
  private readonly cleanupTimer: NodeJS.Timeout;

  public constructor(
    private readonly ttlMs: number,
    cleanupIntervalMs: number,
    private readonly getNow: GetNow = () => Date.now(),
  ) {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  public get(key: string): TResponse | null {
    const current = this.entries.get(key);
    if (!current) {
      return null;
    }

    if (current.expiresAt <= this.getNow()) {
      this.entries.delete(key);
      return null;
    }

    return current.response;
  }

  public set(key: string, response: TResponse): void {
    this.entries.set(key, {
      response,
      expiresAt: this.getNow() + this.ttlMs,
    });
  }

  public checkAndSet(key: string, createResponse: () => TResponse): TResponse {
    const existing = this.get(key);
    if (existing) {
      return existing;
    }

    const response = createResponse();
    this.set(key, response);
    return response;
  }

  public cleanupExpired(): void {
    const now = this.getNow();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  public shutdown(): void {
    clearInterval(this.cleanupTimer);
    this.entries.clear();
  }
}
