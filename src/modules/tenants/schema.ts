import { z } from "zod";

const tenantStatusSchema = z.enum(["active", "inactive"]);
const apiKeyStatusSchema = z.enum(["active", "revoked"]);
const credentialStatusSchema = z.enum(["active", "rotated", "revoked"]);

const CNPJ_REGEX = /^\d{14}$/;
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export const createTenantSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(255),
    cnpj: z.string().trim().regex(CNPJ_REGEX, "Campo 'cnpj' deve conter 14 digitos"),
    phoneNumber: z
      .string()
      .trim()
      .regex(PHONE_REGEX, "Campo 'phoneNumber' deve estar no formato E.164"),
    key: z.string().trim().min(8).max(512),
    metaPhoneNumberId: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const updateTenantSchema = z
  .object({
    code: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    cnpj: z
      .string()
      .trim()
      .regex(CNPJ_REGEX, "Campo 'cnpj' deve conter 14 digitos")
      .optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(PHONE_REGEX, "Campo 'phoneNumber' deve estar no formato E.164")
      .optional(),
    status: tenantStatusSchema.optional(),
    key: z.string().trim().min(8).max(512).optional(),
    keyStatus: apiKeyStatusSchema.optional(),
    metaPhoneNumberId: z.string().trim().min(1).max(64).optional(),
    credentialStatus: credentialStatusSchema.optional(),
    label: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizacao",
  });

export const listTenantsQuerySchema = z
  .object({
    status: tenantStatusSchema.optional(),
    code: z.string().trim().min(1).max(64).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const tenantIdParamSchema = z
  .object({
    id: z.string().uuid("Parametro 'id' deve ser um UUID valido"),
  })
  .strict();

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type ListTenantsQueryInput = z.infer<typeof listTenantsQuerySchema>;
export type TenantIdParamInput = z.infer<typeof tenantIdParamSchema>;
