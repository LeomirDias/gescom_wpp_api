import type { Request, Response } from "express";
import type { z } from "zod";
import { ValidationError } from "../../shared/errors/app-error";
import type { RequestWithId } from "../../shared/middleware/request-id";
import {
  listTenantsQuerySchema,
  tenantIdParamSchema,
  type CreateTenantInput,
  type UpdateTenantInput,
} from "./schema";
import { TenantsService } from "./service";

type ValidationIssue = {
  path: string;
  message: string;
};

const parseOrThrow = <TOutput>(
  schema: z.ZodType<TOutput>,
  value: unknown,
  scope: string,
): TOutput => {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const details: ValidationIssue[] = parsed.error.issues.map((issue) => ({
    path: issue.path.length ? `${scope}.${issue.path.join(".")}` : scope,
    message: issue.message,
  }));

  throw new ValidationError(details);
};

export class TenantsController {
  public constructor(private readonly service: TenantsService) {}

  public createTenant = async (req: Request, res: Response): Promise<void> => {
    const typedRequest = req as RequestWithId & { body: CreateTenantInput };
    const response = await this.service.createTenant(
      typedRequest.requestId,
      req.path,
      typedRequest.body,
    );

    res.status(201).json(response);
  };

  public updateTenant = async (req: Request, res: Response): Promise<void> => {
    const typedRequest = req as RequestWithId & { body: UpdateTenantInput };
    const params = parseOrThrow(tenantIdParamSchema, req.params, "params");
    const response = await this.service.updateTenant(
      typedRequest.requestId,
      req.path,
      params.id,
      typedRequest.body,
    );

    res.status(200).json(response);
  };

  public deleteTenant = async (req: Request, res: Response): Promise<void> => {
    const typedRequest = req as RequestWithId;
    const params = parseOrThrow(tenantIdParamSchema, req.params, "params");
    await this.service.deleteTenant(typedRequest.requestId, req.path, params.id);
    res.status(204).send();
  };

  public getTenantById = async (req: Request, res: Response): Promise<void> => {
    const typedRequest = req as RequestWithId;
    const params = parseOrThrow(tenantIdParamSchema, req.params, "params");
    const response = await this.service.getTenantById(
      typedRequest.requestId,
      req.path,
      params.id,
    );

    res.status(200).json(response);
  };

  public listTenants = async (req: Request, res: Response): Promise<void> => {
    const typedRequest = req as RequestWithId;
    const query = parseOrThrow(listTenantsQuerySchema, req.query, "query");
    const response = await this.service.listTenants(
      typedRequest.requestId,
      req.path,
      query,
    );

    res.status(200).json(response);
  };
}
