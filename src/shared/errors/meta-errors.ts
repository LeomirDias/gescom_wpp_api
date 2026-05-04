import { AppError } from "./app-error";

/**
 * Representa uma falha da WhatsApp Cloud API (Meta).
 *
 * Classificacao de `isRetryable` considera HTTP status + codigo Meta,
 * conforme `docs/whatsapp-cloud-api-payloads.md`:
 *   - 5xx / timeout / erro de rede => retry
 *   - 429 => retry (rate limit HTTP)
 *   - 401/403 (ex.: codigo Meta 190) => nao retry
 *   - 400 (ex.: codigos 100, 131030, 131047) => nao retry
 *   - Meta code 131053 (rate limit de negocio) => retry
 *   - Demais 4xx => nao retry por padrao
 */

export type MetaApiErrorInput = {
  httpStatus: number;
  metaCode?: number;
  metaType?: string;
  metaMessage?: string;
  fbtraceId?: string;
  cause?: string;
  isNetworkError?: boolean;
  isTimeout?: boolean;
};

const DEFINITIVE_META_CODES: ReadonlySet<number> = new Set([
  100, // GraphMethodException - parametro invalido
  131030, // numero destinatario invalido
  131047, // janela de atendimento fechada
  190, // OAuthException - token invalido/expirado
]);

const RETRYABLE_META_CODES: ReadonlySet<number> = new Set([
  131053, // rate limit / limite de envio
]);

const classifyRetryable = (input: MetaApiErrorInput): boolean => {
  if (input.isNetworkError || input.isTimeout) {
    return true;
  }

  if (input.metaCode !== undefined) {
    if (DEFINITIVE_META_CODES.has(input.metaCode)) {
      return false;
    }
    if (RETRYABLE_META_CODES.has(input.metaCode)) {
      return true;
    }
  }

  const status = input.httpStatus;

  if (status >= 500 && status <= 599) {
    return true;
  }

  if (status === 429) {
    return true;
  }

  if (status >= 400 && status <= 499) {
    return false;
  }

  return false;
};

const buildMessage = (input: MetaApiErrorInput): string => {
  if (input.metaMessage && input.metaCode !== undefined) {
    return `Meta API error ${input.metaCode}: ${input.metaMessage}`;
  }
  if (input.metaMessage) {
    return `Meta API error: ${input.metaMessage}`;
  }
  if (input.isTimeout) {
    return "Meta API timeout";
  }
  if (input.isNetworkError) {
    return `Meta API network error${input.cause ? `: ${input.cause}` : ""}`;
  }
  return `Meta API HTTP ${input.httpStatus}`;
};

export class MetaApiError extends AppError {
  public readonly httpStatus: number;
  public readonly metaCode?: number;
  public readonly metaType?: string;
  public readonly metaMessage?: string;
  public readonly fbtraceId?: string;
  public readonly isRetryable: boolean;
  public readonly isTimeout: boolean;
  public readonly isNetworkError: boolean;

  public constructor(input: MetaApiErrorInput) {
    super({
      statusCode: 502,
      code: "META_API_ERROR",
      message: buildMessage(input),
    });

    this.httpStatus = input.httpStatus;
    this.metaCode = input.metaCode;
    this.metaType = input.metaType;
    this.metaMessage = input.metaMessage;
    this.fbtraceId = input.fbtraceId;
    this.isTimeout = Boolean(input.isTimeout);
    this.isNetworkError = Boolean(input.isNetworkError);
    this.isRetryable = classifyRetryable(input);
  }

  public toLogPayload(): Record<string, unknown> {
    return {
      httpStatus: this.httpStatus,
      metaCode: this.metaCode,
      metaType: this.metaType,
      fbtraceId: this.fbtraceId,
      isTimeout: this.isTimeout,
      isNetworkError: this.isNetworkError,
      isRetryable: this.isRetryable,
    };
  }
}
