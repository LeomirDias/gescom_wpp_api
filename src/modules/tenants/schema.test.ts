import assert from "node:assert/strict";
import test from "node:test";
import {
  createTenantSchema,
  listTenantsQuerySchema,
  tenantIdParamSchema,
  updateTenantSchema,
} from "./schema";

test("createTenantSchema aceita payload valido", () => {
  const parsed = createTenantSchema.safeParse({
    code: "tenant-sp",
    name: "Tenant Sao Paulo",
    cnpj: "12345678000195",
    phoneNumber: "+5511999999999",
    key: "apikey-super-segura",
    metaPhoneNumberId: "1234567890",
  });

  assert.equal(parsed.success, true);
});

test("createTenantSchema rejeita cnpj invalido", () => {
  const parsed = createTenantSchema.safeParse({
    code: "tenant-sp",
    name: "Tenant Sao Paulo",
    cnpj: "123",
    phoneNumber: "+5511999999999",
    key: "apikey-super-segura",
    metaPhoneNumberId: "1234567890",
  });

  assert.equal(parsed.success, false);
});

test("updateTenantSchema exige ao menos um campo", () => {
  const parsed = updateTenantSchema.safeParse({});
  assert.equal(parsed.success, false);
});

test("listTenantsQuerySchema aplica defaults", () => {
  const parsed = listTenantsQuerySchema.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 20);
});

test("tenantIdParamSchema valida UUID", () => {
  const valid = tenantIdParamSchema.safeParse({
    id: "f5e17113-6cb4-4e42-9847-574ebdb8aaf4",
  });
  const invalid = tenantIdParamSchema.safeParse({ id: "abc" });
  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});
