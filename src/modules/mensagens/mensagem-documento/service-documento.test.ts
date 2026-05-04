import assert from "node:assert/strict";
import test from "node:test";
import type {
  DocumentStorageRef,
  SendDocumentMessageJobPayload,
} from "../../../shared/queue/queue-connection.interface";

const ensureEnvForTests = (): void => {
  process.env.NODE_ENV ??= "test";
  process.env.PORT ??= "3000";
  process.env.API_KEYS ??= "api-key-test";
  process.env.CRUD_API_KEY ??= "crud-api-key-test";
  process.env.META_API_BASE_URL ??= "https://graph.facebook.com/v25.0";
  process.env.META_PHONE_NUMBER_ID ??= "meta-phone-test";
  process.env.META_ACCESS_TOKEN ??= "meta-token-test";
  process.env.QUEUE_DRIVER ??= "memory";
  process.env.LOCAL_QUEUE_PREFIX ??= "local-test";
  process.env.QUEUE_PREFIX ??= "queue-test";
  process.env.RATE_LIMIT_WINDOW_MS ??= "60000";
  process.env.RATE_LIMIT_MAX ??= "100";
  process.env.REQUEST_TIMEOUT_MS ??= "10000";
  process.env.IDEMPOTENCY_TTL_MS ??= "600000";
  process.env.IDEMPOTENCY_CLEANUP_INTERVAL_MS ??= "60000";
  process.env.QUEUE_MAX_ATTEMPTS ??= "3";
  process.env.DEAD_LETTER_RETENTION_MS ??= "86400000";
  process.env.AUDIT_ENABLED ??= "false";
  process.env.AUDIT_REDIS_PREFIX ??= "audit";
  process.env.AUDIT_RETENTION_DAYS ??= "30";
  process.env.AUDIT_CLEANUP_INTERVAL_MS ??= "60000";
  process.env.SUPABASE_URL ??= "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY ??= "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service";
  process.env.SUPABASE_DOCUMENTS_BUCKET ??= "mensagens-documentos-test";
  process.env.DOCUMENT_UPLOAD_MAX_BYTES ??= "104857600";
  process.env.DRIZZLE_DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
};

const buildAuthContext = () => ({
  tenantId: "tenant-1",
  apiKeyPrefix: "api-prefix-1",
  metaPhoneNumberId: "123456789",
});

const buildUpload = () => ({
  buffer: Buffer.from("conteudo-fake"),
  originalFilename: "arquivo.pdf",
  mimeType: "application/pdf",
  sizeBytes: "conteudo-fake".length,
});

test("MensagensDocumentoService faz upload no storage e publica payload com tenantId/metaPhoneNumberId", async () => {
  ensureEnvForTests();
  const { MensagensDocumentoService } = require("./service-documento") as typeof import("./service-documento");
  const { InMemoryIdempotencyStore } = require("../idempotency-store") as typeof import("../idempotency-store");

  let publishedPayload: SendDocumentMessageJobPayload | null = null;
  let uploadCalls = 0;
  const expectedRef: DocumentStorageRef = {
    bucket: "mensagens-documentos-test",
    key: "tenants/tenant-1/2026-05-04/job-stub.pdf",
    mimeType: "application/pdf",
    sizeBytes: 13,
  };

  const service = new MensagensDocumentoService(
    async (payload: SendDocumentMessageJobPayload) => {
      publishedPayload = payload;
      return {};
    },
    new InMemoryIdempotencyStore<{
      requestId: string;
      jobId: string;
      status: "queued";
      createdAt: string;
    }>(60000, 30000),
    async () => {
      uploadCalls += 1;
      return expectedRef;
    },
  );

  await service.enfileirarMensagemDocumento(
    "req-12345678",
    {
      to: "+5511999999999",
      sourceSystem: "gescom",
      correlationId: "corr-12345678",
      document: {
        caption: "arquivo",
        filename: "arquivo.pdf",
      },
    },
    buildUpload(),
    buildAuthContext(),
  );

  assert.equal(uploadCalls, 1);
  assert.ok(publishedPayload);
  const payload = publishedPayload as SendDocumentMessageJobPayload;
  assert.equal(payload.tenantId, "tenant-1");
  assert.equal(payload.apiKeyPrefix, "api-prefix-1");
  assert.equal(payload.metaPhoneNumberId, "123456789");
  assert.equal(payload.document.caption, "arquivo");
  assert.equal(payload.document.filename, "arquivo.pdf");
  assert.deepEqual(payload.document.storage, expectedRef);
});

test("MensagensDocumentoService nao faz upload em idempotency hit", async () => {
  ensureEnvForTests();
  const { MensagensDocumentoService } = require("./service-documento") as typeof import("./service-documento");
  const { InMemoryIdempotencyStore } = require("../idempotency-store") as typeof import("../idempotency-store");

  let uploadCalls = 0;
  let publishCalls = 0;
  const expectedRef: DocumentStorageRef = {
    bucket: "mensagens-documentos-test",
    key: "tenants/tenant-1/2026-05-04/job-stub.pdf",
    mimeType: "application/pdf",
    sizeBytes: 13,
  };

  const service = new MensagensDocumentoService(
    async () => {
      publishCalls += 1;
      return {};
    },
    new InMemoryIdempotencyStore<{
      requestId: string;
      jobId: string;
      status: "queued";
      createdAt: string;
    }>(60000, 30000),
    async () => {
      uploadCalls += 1;
      return expectedRef;
    },
  );

  const input = {
    to: "+5511999999999",
    sourceSystem: "gescom",
    correlationId: "corr-12345678",
    document: {
      caption: "arquivo",
      filename: "arquivo.pdf",
    },
  };

  await service.enfileirarMensagemDocumento(
    "req-1",
    input,
    buildUpload(),
    buildAuthContext(),
  );
  await service.enfileirarMensagemDocumento(
    "req-2",
    input,
    buildUpload(),
    buildAuthContext(),
  );

  assert.equal(uploadCalls, 1);
  assert.equal(publishCalls, 1);
});
