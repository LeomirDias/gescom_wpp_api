import { randomBytes, scryptSync } from "node:crypto";
import { and, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import {
  apiRequestAudit,
  tenantApiKeys,
  tenantMetaCredentials,
  tenants,
} from "../../db/schema";
import { ConflictError, NotFoundError } from "../../shared/errors/app-error";
import type {
  CreateTenantInput,
  ListTenantsQueryInput,
  UpdateTenantInput,
} from "./schema";

type AuditResult = "allowed" | "denied" | "error";

type TenantResponse = {
  id: string;
  code: string;
  name: string;
  cnpj: string;
  phoneNumber: string;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
  apiKey: {
    id: string;
    keyPrefix: string;
    label: string | null;
    status: "active" | "revoked";
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  credentials: {
    id: string;
    metaPhoneNumberId: string;
    status: "active" | "rotated" | "revoked";
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

type ListTenantsOutput = {
  items: TenantResponse[];
  page: number;
  pageSize: number;
  total: number;
};

type RequestAuditInput = {
  requestId: string;
  type:
    | "createTenant"
    | "updateTenant"
    | "deleteTenant"
    | "getTenantById"
    | "listTenants";
  endpoint: string;
  result: AuditResult;
  reason?: string;
  tenantId?: string;
  apiKeyPrefix?: string;
  resolvedMetaPhoneId?: string;
};

const deriveApiKeyPrefix = (apiKey: string): string => {
  const normalized = apiKey.trim();
  const sliced = normalized.slice(0, 12);
  return sliced.padEnd(Math.min(12, normalized.length), "*");
};

const hashApiKey = (apiKey: string): string => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(apiKey, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const mapTenantResponse = (
  tenant: typeof tenants.$inferSelect,
  apiKey: typeof tenantApiKeys.$inferSelect | undefined,
  credential: typeof tenantMetaCredentials.$inferSelect | undefined,
): TenantResponse => {
  return {
    id: tenant.id,
    code: tenant.code,
    name: tenant.name,
    cnpj: tenant.cnpj,
    phoneNumber: tenant.phoneNumber,
    status: tenant.status,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
    apiKey: apiKey
      ? {
          id: apiKey.id,
          keyPrefix: apiKey.keyPrefix,
          label: apiKey.label,
          status: apiKey.status,
          lastUsedAt: apiKey.lastUsedAt,
          expiresAt: apiKey.expiresAt,
          createdAt: apiKey.createdAt,
          updatedAt: apiKey.updatedAt,
        }
      : null,
    credentials: credential
      ? {
          id: credential.id,
          metaPhoneNumberId: credential.metaPhoneNumberId,
          status: credential.status,
          createdAt: credential.createdAt,
          updatedAt: credential.updatedAt,
        }
      : null,
  };
};

export class TenantsService {
  public async createTenant(
    requestId: string,
    endpoint: string,
    input: CreateTenantInput,
  ): Promise<TenantResponse> {
    try {
      const createdTenant = await db.transaction(async (tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({
            code: input.code,
            name: input.name,
            cnpj: input.cnpj,
            phoneNumber: input.phoneNumber,
          })
          .returning();

        const [apiKey] = await tx
          .insert(tenantApiKeys)
          .values({
            tenantId: tenant.id,
            keyHash: hashApiKey(input.key),
            keyPrefix: deriveApiKeyPrefix(input.key),
            label: input.label,
          })
          .returning();

        const [credential] = await tx
          .insert(tenantMetaCredentials)
          .values({
            tenantId: tenant.id,
            metaPhoneNumberId: input.metaPhoneNumberId,
          })
          .returning();

        return mapTenantResponse(tenant, apiKey, credential);
      });

      await this.writeAudit({
        requestId,
        endpoint,
        result: "allowed",
        tenantId: createdTenant.id,
        apiKeyPrefix: createdTenant.apiKey?.keyPrefix ?? undefined,
        resolvedMetaPhoneId:
          createdTenant.credentials?.metaPhoneNumberId ?? undefined,
        type: "createTenant",
      });

      return createdTenant;
    } catch (error) {
      const normalizedError = this.normalizeDbError(error);

      await this.writeAudit({
        requestId,
        endpoint,
        result: "error",
        reason: normalizedError.message,
        type: "createTenant",
      });

      throw normalizedError;
    }
  }

  public async updateTenant(
    requestId: string,
    endpoint: string,
    tenantId: string,
    input: UpdateTenantInput,
  ): Promise<TenantResponse> {
    const current = await this.fetchTenantAggregate(tenantId);
    if (!current) {
      await this.writeAudit({
        requestId,
        endpoint,
        result: "denied",
        reason: "Tenant nao encontrado",
        tenantId,
        type: "updateTenant",
      });
      throw new NotFoundError("Tenant nao encontrado", "TENANT_NOT_FOUND");
    }

    try {
      await db.transaction(async (tx) => {
        const tenantValues: Partial<typeof tenants.$inferInsert> = {};
        if (input.code !== undefined) tenantValues.code = input.code;
        if (input.name !== undefined) tenantValues.name = input.name;
        if (input.cnpj !== undefined) tenantValues.cnpj = input.cnpj;
        if (input.phoneNumber !== undefined)
          tenantValues.phoneNumber = input.phoneNumber;
        if (input.status !== undefined) tenantValues.status = input.status;
        if (Object.keys(tenantValues).length > 0) {
          tenantValues.updatedAt = new Date();
          await tx
            .update(tenants)
            .set(tenantValues)
            .where(eq(tenants.id, tenantId));
        }

        const apiKeyValues: Partial<typeof tenantApiKeys.$inferInsert> = {};
        if (input.key !== undefined) {
          apiKeyValues.keyHash = hashApiKey(input.key);
          apiKeyValues.keyPrefix = deriveApiKeyPrefix(input.key);
        }
        if (input.keyStatus !== undefined)
          apiKeyValues.status = input.keyStatus;
        if (input.label !== undefined) apiKeyValues.label = input.label;
        if (Object.keys(apiKeyValues).length > 0) {
          apiKeyValues.updatedAt = new Date();
          await tx
            .update(tenantApiKeys)
            .set(apiKeyValues)
            .where(eq(tenantApiKeys.tenantId, tenantId));
        }

        const credentialValues: Partial<
          typeof tenantMetaCredentials.$inferInsert
        > = {};
        if (input.metaPhoneNumberId !== undefined) {
          credentialValues.metaPhoneNumberId = input.metaPhoneNumberId;
        }
        if (input.credentialStatus !== undefined) {
          credentialValues.status = input.credentialStatus;
        }
        if (Object.keys(credentialValues).length > 0) {
          credentialValues.updatedAt = new Date();
          await tx
            .update(tenantMetaCredentials)
            .set(credentialValues)
            .where(eq(tenantMetaCredentials.tenantId, tenantId));
        }
      });
      const updated = await this.fetchTenantAggregate(tenantId);
      if (!updated) {
        throw new NotFoundError("Tenant nao encontrado", "TENANT_NOT_FOUND");
      }

      await this.writeAudit({
        requestId,
        endpoint,
        result: "allowed",
        tenantId: updated.id,
        apiKeyPrefix: updated.apiKey?.keyPrefix ?? undefined,
        resolvedMetaPhoneId:
          updated.credentials?.metaPhoneNumberId ?? undefined,
        type: "updateTenant",
      });

      return updated;
    } catch (error) {
      const normalizedError = this.normalizeDbError(error);
      await this.writeAudit({
        requestId,
        endpoint,
        result: "error",
        reason: normalizedError.message,
        tenantId,
        type: "updateTenant",
      });
      throw normalizedError;
    }
  }

  public async deleteTenant(
    requestId: string,
    endpoint: string,
    tenantId: string,
  ): Promise<void> {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!tenant) {
      await this.writeAudit({
        requestId,
        endpoint,
        result: "denied",
        reason: "Tenant nao encontrado",
        tenantId,
        type: "deleteTenant",
      });
      throw new NotFoundError("Tenant nao encontrado", "TENANT_NOT_FOUND");
    }

    if (tenant.status === "inactive") {
      await this.writeAudit({
        requestId,
        endpoint,
        result: "denied",
        reason: "Tenant nao encontrado",
        tenantId,
        type: "deleteTenant",
      });
      throw new NotFoundError("Tenant nao encontrado", "TENANT_NOT_FOUND");
    }

    await db.transaction(async (tx) => {
      const now = new Date();

      await tx
        .update(tenantApiKeys)
        .set({
          status: "revoked",
          updatedAt: now,
        })
        .where(eq(tenantApiKeys.tenantId, tenantId));

      await tx
        .update(tenantMetaCredentials)
        .set({
          status: "revoked",
          updatedAt: now,
        })
        .where(eq(tenantMetaCredentials.tenantId, tenantId));

      await tx
        .update(tenants)
        .set({
          status: "inactive",
          updatedAt: now,
        })
        .where(eq(tenants.id, tenantId));
    });

    await this.writeAudit({
      requestId,
      endpoint,
      result: "allowed",
      tenantId,
      type: "deleteTenant",
    });
  }

  public async getTenantById(
    requestId: string,
    endpoint: string,
    tenantId: string,
  ): Promise<TenantResponse> {
    const tenant = await this.fetchTenantAggregate(tenantId);
    if (!tenant) {
      await this.writeAudit({
        requestId,
        endpoint,
        result: "denied",
        reason: "Tenant nao encontrado",
        tenantId,
        type: "getTenantById",
      });
      throw new NotFoundError("Tenant nao encontrado", "TENANT_NOT_FOUND");
    }

    await this.writeAudit({
      requestId,
      endpoint,
      result: "allowed",
      tenantId: tenant.id,
      apiKeyPrefix: tenant.apiKey?.keyPrefix ?? undefined,
      resolvedMetaPhoneId: tenant.credentials?.metaPhoneNumberId ?? undefined,
      type: "getTenantById",
    });

    return tenant;
  }

  public async listTenants(
    requestId: string,
    endpoint: string,
    query: ListTenantsQueryInput,
  ): Promise<ListTenantsOutput> {
    const filters: SQL[] = [];
    if (query.status) {
      filters.push(eq(tenants.status, query.status));
    }
    if (query.code) {
      filters.push(ilike(tenants.code, `%${query.code}%`));
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const offset = (query.page - 1) * query.pageSize;
    const [rows, countRows] = await Promise.all([
      db.query.tenants.findMany({
        where: whereClause,
        orderBy: desc(tenants.createdAt),
        limit: query.pageSize,
        offset,
      }),
      db
        .select({ total: sql<number>`count(*)` })
        .from(tenants)
        .where(whereClause),
    ]);

    const tenantIds = rows.map((row) => row.id);
    const [apiKeys, credentials] = tenantIds.length
      ? await Promise.all([
          db.query.tenantApiKeys.findMany({
            where: inArray(tenantApiKeys.tenantId, tenantIds),
            orderBy: desc(tenantApiKeys.createdAt),
          }),
          db.query.tenantMetaCredentials.findMany({
            where: inArray(tenantMetaCredentials.tenantId, tenantIds),
            orderBy: desc(tenantMetaCredentials.createdAt),
          }),
        ])
      : [[], []];

    const apiKeysMap = new Map(apiKeys.map((item) => [item.tenantId, item]));
    const credentialsMap = new Map(
      credentials.map((item) => [item.tenantId, item]),
    );

    const items = rows.map((tenant) =>
      mapTenantResponse(
        tenant,
        apiKeysMap.get(tenant.id),
        credentialsMap.get(tenant.id),
      ),
    );

    await this.writeAudit({
      requestId,
      endpoint,
      result: "allowed",
      reason: `Lista retornada (${items.length} itens)`,
      type: "listTenants",
    });

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  private async fetchTenantAggregate(
    tenantId: string,
  ): Promise<TenantResponse | null> {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!tenant) {
      return null;
    }

    const [apiKey, credential] = await Promise.all([
      db.query.tenantApiKeys.findFirst({
        where: eq(tenantApiKeys.tenantId, tenant.id),
        orderBy: desc(tenantApiKeys.createdAt),
      }),
      db.query.tenantMetaCredentials.findFirst({
        where: eq(tenantMetaCredentials.tenantId, tenant.id),
        orderBy: desc(tenantMetaCredentials.createdAt),
      }),
    ]);

    return mapTenantResponse(tenant, apiKey, credential);
  }

  private async writeAudit(input: RequestAuditInput): Promise<void> {
    await db.insert(apiRequestAudit).values({
      requestId: input.requestId,
      tenantId: input.tenantId,
      apiKeyPrefix: input.apiKeyPrefix,
      endpoint: input.endpoint,
      resolvedMetaPhoneId: input.resolvedMetaPhoneId,
      result: input.result,
      reason: input.reason,
      type: input.type,
    });
  }

  private normalizeDbError(error: unknown): Error {
    if (error instanceof NotFoundError || error instanceof ConflictError) {
      return error;
    }

    const message =
      error instanceof Error
        ? error.message
        : "Erro inesperado ao persistir tenant";

    if (message.includes("duplicate key")) {
      return new ConflictError(
        "Ja existe tenant com os dados informados (code, cnpj, phoneNumber ou keyPrefix)",
        "TENANT_CONFLICT",
      );
    }

    return new Error(message);
  }
}
