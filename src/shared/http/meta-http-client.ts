import axios, { AxiosError, AxiosHeaders, type AxiosInstance } from "axios";
import { env } from "../../config/env";
import { MetaApiError } from "../errors/meta-errors";

/**
 * Cliente Axios dedicado para a WhatsApp Cloud API (Meta).
 *
 * - Usa `META_API_BASE_URL` como baseURL e `REQUEST_TIMEOUT_MS` como timeout.
 * - Authorization Bearer injetado em tempo de criacao.
 * - Interceptadores emitem logs estruturados sem vazar token ou body sensivel.
 * - Falhas sao normalizadas para `MetaApiError`, com classificacao transient vs definitivo.
 */

const REQUEST_START_HEADER = "x-meta-client-start";

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    fbtrace_id?: string;
  };
};

const isFormDataPayload = (value: unknown): boolean => {
  return typeof FormData !== "undefined" && value instanceof FormData;
};

const readHeaderValue = (headers: unknown, key: string): string | undefined => {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof AxiosHeaders) {
    const value = headers.get(key);
    return typeof value === "string" ? value : undefined;
  }

  const record = headers as Record<string, unknown>;
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const extractContextHeaders = (
  headers: unknown,
): { requestId?: string; jobId?: string } => {
  return {
    requestId: readHeaderValue(headers, "x-request-id"),
    jobId: readHeaderValue(headers, "x-job-id"),
  };
};

export const buildMetaMessagesPath = (phoneNumberId: string): string => {
  return `/${encodeURIComponent(phoneNumberId)}/messages`;
};

export const buildMetaMediaPath = (phoneNumberId: string): string => {
  return `/${encodeURIComponent(phoneNumberId)}/media`;
};

const createClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: env.META_API_BASE_URL,
    timeout: env.REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  client.interceptors.request.use((config) => {
    const context = extractContextHeaders(config.headers);

    const headers = AxiosHeaders.from(config.headers);
    if (isFormDataPayload(config.data)) {
      // Para upload multipart, o Axios deve montar o Content-Type com boundary.
      headers.delete("Content-Type");
    }
    headers.set(REQUEST_START_HEADER, String(Date.now()));
    config.headers = headers;

    console.info({
      event: "meta_http_request",
      method: config.method?.toUpperCase() ?? "GET",
      url: config.url,
      requestId: context.requestId,
      jobId: context.jobId,
    });

    return config;
  });

  client.interceptors.response.use(
    (response) => {
      const context = extractContextHeaders(response.config.headers);
      const startHeader = readHeaderValue(response.config.headers, REQUEST_START_HEADER);
      const startedAt = startHeader ? Number(startHeader) : NaN;
      const durationMs = Number.isFinite(startedAt) ? Date.now() - startedAt : undefined;

      console.info({
        event: "meta_http_response",
        status: response.status,
        url: response.config.url,
        requestId: context.requestId,
        jobId: context.jobId,
        durationMs,
      });

      return response;
    },
    (error: unknown) => {
      const metaError = normalizeError(error);

      console.error({
        event: "meta_http_error",
        ...metaError.toLogPayload(),
      });

      return Promise.reject(metaError);
    },
  );

  return client;
};

const normalizeError = (error: unknown): MetaApiError => {
  if (error instanceof MetaApiError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<MetaErrorBody>;
    const response = axiosError.response;
    const isTimeout = axiosError.code === "ECONNABORTED";
    const isNetworkError = !response && !isTimeout;

    return new MetaApiError({
      httpStatus: response?.status ?? 0,
      metaCode: response?.data?.error?.code,
      metaType: response?.data?.error?.type,
      metaMessage: response?.data?.error?.message,
      fbtraceId: response?.data?.error?.fbtrace_id,
      cause: axiosError.message,
      isTimeout,
      isNetworkError,
    });
  }

  return new MetaApiError({
    httpStatus: 0,
    isNetworkError: true,
    cause: error instanceof Error ? error.message : String(error),
  });
};

export const metaHttpClient: AxiosInstance = createClient();
