import { Router } from "express";
import { validateSchema } from "../../shared/middleware/validate-schema";
import { TenantsController } from "./controller";
import { createTenantSchema, updateTenantSchema } from "./schema";
import { TenantsService } from "./service";

const tenantsRouter = Router();
const tenantsController = new TenantsController(new TenantsService());

tenantsRouter.post("/", validateSchema(createTenantSchema), tenantsController.createTenant);
tenantsRouter.put("/:id", validateSchema(updateTenantSchema), tenantsController.updateTenant);
tenantsRouter.delete("/:id", tenantsController.deleteTenant);
tenantsRouter.get("/:id", tenantsController.getTenantById);
tenantsRouter.get("/", tenantsController.listTenants);

export { tenantsRouter };
