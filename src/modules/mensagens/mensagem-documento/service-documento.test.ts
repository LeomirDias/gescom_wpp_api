import assert from "node:assert/strict";
import test from "node:test";
import type { SendDocumentMessageJobPayload } from "../../../shared/queue/queue-connection.interface";

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
  process.env.DRIZZLE_DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/db";
};

test("MensagensDocumentoService publica payload com tenantId e metaPhoneNumberId", async () => {
  ensureEnvForTests();
  const { MensagensDocumentoService } = require("./service-documento") as typeof import("./service-documento");

  let publishedPayload: SendDocumentMessageJobPayload | null = null;
  const service = new MensagensDocumentoService(
    async (payload: SendDocumentMessageJobPayload) => {
    publishedPayload = payload;
    return {};
    },
  );

  await service.enfileirarMensagemDocumento(
    "req-12345678",
    {
      to: "+5511999999999",
      sourceSystem: "gescom",
      correlationId: "corr-12345678",
      document: {
        path: "C:\\docs\\arquivo.pdf",
        caption: "arquivo",
        filename: "arquivo.pdf",
      },
    },
    {
      tenantId: "tenant-1",
      apiKeyPrefix: "api-prefix-1",
      metaPhoneNumberId: "123456789",
    },
  );

  assert.ok(publishedPayload);
  const payload = publishedPayload as SendDocumentMessageJobPayload;
  assert.equal(payload.tenantId, "tenant-1");
  assert.equal(payload.apiKeyPrefix, "api-prefix-1");
  assert.equal(payload.metaPhoneNumberId, "123456789");
});
