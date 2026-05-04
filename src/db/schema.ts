import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const tenantStatusEnum = pgEnum("tenant_status", ["active", "inactive"]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "revoked"]);
export const credentialStatusEnum = pgEnum("credential_status", [
  "active",
  "rotated",
  "revoked",
]);
export const requestAuditResultEnum = pgEnum("request_audit_result", [
  "allowed",
  "denied",
  "error",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  cnpj: varchar("cnpj", { length: 14 }).notNull().unique(),
  phoneNumber: varchar("phone_number", { length: 15 }).notNull().unique(),
  status: tenantStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tenantApiKeys = pgTable(
  "tenant_api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    keyHash: varchar("key_hash", { length: 255 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
    label: varchar("label", { length: 100 }),
    status: apiKeyStatusEnum("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index("idx_tenant_api_keys_tenant").on(table.tenantId),
    statusIdx: index("idx_tenant_api_keys_status").on(table.status),
    keyPrefixUq: uniqueIndex("uq_tenant_api_keys_prefix").on(table.keyPrefix),
  }),
);

export const tenantMetaCredentials = pgTable(
  "tenant_meta_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    metaPhoneNumberId: varchar("meta_phone_number_id", {
      length: 64,
    }).notNull(),
    status: credentialStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantStatusIdx: index("idx_meta_creds_tenant_status").on(
      table.tenantId,
      table.status,
    ),
    tenantMetaPhoneUq: uniqueIndex(
      "uq_tenant_credentials_meta_phone_number_id",
    ).on(table.tenantId, table.metaPhoneNumberId),
  }),
);

export const apiRequestAudit = pgTable(
  "api_request_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    apiKeyPrefix: varchar("api_key_prefix", { length: 16 }),
    endpoint: varchar("endpoint", { length: 120 }).notNull(),
    resolvedMetaPhoneId: varchar("resolved_meta_phone_id", { length: 64 }),
    result: requestAuditResultEnum("result").notNull(),
    reason: varchar("reason", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    type: text("type").notNull(),
  },
  (table) => ({
    requestIdIdx: index("idx_api_audit_request_id").on(table.requestId),
    tenantCreatedIdx: index("idx_api_audit_tenant_created").on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);
