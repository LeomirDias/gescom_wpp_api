import { scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import {
  apiRequestAudit,
  tenantApiKeys,
  tenantMetaCredentials,
  tenants,
} from "../../db/schema";
import { AppError, NotFoundError, UnauthorizedError } from "../errors/app-error";

const API_KEY_HEADER = "x-api-key";

const parseApiKey = (value: string | string[] | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const parsedValue = value.trim();

  if (!parsedValue) {
    return null;
  }

  return parsedValue;
};

const safeEquals = (value: string, expected: string): boolean => {
  const valueBuffer = Buffer.from(value, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
};

const verifyApiKeyHash = (apiKey: string, persistedHash: string): boolean => {
  const [salt, expectedHash] = persistedHash.split(":");
  if (!salt || !expectedHash) {
    return false;
  }

  const generatedHash = scryptSync(apiKey, salt, 64).toString("hex");
  return safeEquals(generatedHash, expectedHash);
};

const deriveApiKeyPrefix = (apiKey: string): string => {
  const normalized = apiKey.trim();
  const sliced = normalized.slice(0, 12);
  return sliced.padEnd(Math.min(12, normalized.length), "*");
};

const resolveAuditType = (endpoint: string): string => {
  if (endpoint === "/texto") {
    return "sendTextMessage";
  }
  if (endpoint === "/documento") {
    return "sendDocumentMessage";
  }
  if (endpoint === "/fila-atual") {
    return "getQueueSnapshot";
  }
  return "sendMessage";
};

export type MessageAuthContext = {
  tenantId: string;
  apiKeyId?: string;
  apiKeyPrefix: string;
  metaPhoneNumberId: string;
};

export type RequestWithMessageAuth = Request & {
  authContext: MessageAuthContext;
  requestId?: string;
};

const writeAudit = async (input: {
  requestId?: string;
  endpoint: string;
  result: "allowed" | "denied" | "error";
  reason?: string;
  tenantId?: string;
  apiKeyPrefix?: string;
  resolvedMetaPhoneId?: string;
  type: string;
}): Promise<void> => {
  await db.insert(apiRequestAudit).values({
    requestId: input.requestId ?? "unknown",
    tenantId: input.tenantId,
    apiKeyPrefix: input.apiKeyPrefix,
    endpoint: input.endpoint,
    resolvedMetaPhoneId: input.resolvedMetaPhoneId,
    result: input.result,
    reason: input.reason,
    type: input.type,
  });
};

export const authApiKeyMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const run = async (): Promise<void> => {
    const apiKey = parseApiKey(req.headers[API_KEY_HEADER]);
    const typedRequest = req as RequestWithMessageAuth;
    const endpoint = req.path;
    const auditType = resolveAuditType(endpoint);

    if (!apiKey) {
      await writeAudit({
        requestId: typedRequest.requestId,
        endpoint,
        result: "denied",
        reason: "API key ausente",
        type: auditType,
      });
      next(new UnauthorizedError());
      return;
    }

    try {
      const apiKeyPrefix = deriveApiKeyPrefix(apiKey);
      const activeApiKeys = await db.query.tenantApiKeys.findMany({
        where: and(
          eq(tenantApiKeys.keyPrefix, apiKeyPrefix),
          eq(tenantApiKeys.status, "active"),
          or(
            gte(tenantApiKeys.expiresAt, new Date()),
            isNull(tenantApiKeys.expiresAt),
          ),
        ),
        orderBy: desc(tenantApiKeys.createdAt),
      });
      const activeApiKey = activeApiKeys.find((item) =>
        verifyApiKeyHash(apiKey, item.keyHash),
      );

      if (activeApiKey) {
        const tenant = await db.query.tenants.findFirst({
          where: and(
            eq(tenants.id, activeApiKey.tenantId),
            eq(tenants.status, "active"),
          ),
        });

        const credential = tenant
          ? await db.query.tenantMetaCredentials.findFirst({
              where: and(
                eq(tenantMetaCredentials.tenantId, tenant.id),
                eq(tenantMetaCredentials.status, "active"),
              ),
              orderBy: desc(tenantMetaCredentials.createdAt),
            })
          : null;

        if (tenant && credential) {
          await db
            .update(tenantApiKeys)
            .set({
              lastUsedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(tenantApiKeys.id, activeApiKey.id));

          typedRequest.authContext = {
            tenantId: tenant.id,
            apiKeyId: activeApiKey.id,
            apiKeyPrefix: activeApiKey.keyPrefix,
            metaPhoneNumberId: credential.metaPhoneNumberId,
          };

          await writeAudit({
            requestId: typedRequest.requestId,
            endpoint,
            result: "allowed",
            tenantId: tenant.id,
            apiKeyPrefix: activeApiKey.keyPrefix,
            resolvedMetaPhoneId: credential.metaPhoneNumberId,
            type: auditType,
          });

          next();
          return;
        }
      }

      await writeAudit({
        requestId: typedRequest.requestId,
        endpoint,
        result: "denied",
        reason: "Tenant nao encontrado para a API key informada",
        apiKeyPrefix,
        type: auditType,
      });
      next(
        new NotFoundError(
          "Tenant nao encontrado para a API key informada",
          "TENANT_NOT_FOUND_BY_API_KEY",
        ),
      );
    } catch (error) {
      await writeAudit({
        requestId: typedRequest.requestId,
        endpoint,
        result: "error",
        reason: error instanceof Error ? error.message : String(error),
        type: auditType,
      });

      if (error instanceof AppError) {
        next(error);
        return;
      }

      next(error);
    }
  };

  void run().catch(next);
};
