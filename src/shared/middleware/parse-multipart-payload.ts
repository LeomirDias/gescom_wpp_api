import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../errors/app-error";

const PAYLOAD_FIELD = "payload";

/**
 * Em endpoints multipart/form-data com `file` + `payload`, este middleware
 * substitui `req.body` pelo JSON contido no campo `payload`. Permite que o
 * `validateSchema(zodSchema)` rode com o mesmo formato dos endpoints JSON.
 */
export const parseMultipartPayload = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const body = req.body as Record<string, unknown> | undefined;
  const rawPayload = body?.[PAYLOAD_FIELD];

  if (typeof rawPayload !== "string" || rawPayload.trim().length === 0) {
    next(
      new ValidationError([
        {
          path: PAYLOAD_FIELD,
          message:
            "Campo 'payload' (JSON string com metadados) e obrigatorio no multipart",
        },
      ]),
    );
    return;
  }

  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      next(
        new ValidationError([
          {
            path: PAYLOAD_FIELD,
            message: "Campo 'payload' deve ser um objeto JSON",
          },
        ]),
      );
      return;
    }
    req.body = parsed;
    next();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "JSON invalido";
    next(
      new ValidationError([
        {
          path: PAYLOAD_FIELD,
          message: `Campo 'payload' contem JSON invalido: ${reason}`,
        },
      ]),
    );
  }
};
