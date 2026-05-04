import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { UnauthorizedError } from "../errors/app-error";

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

export const authCrudApiKeyMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const apiKey = parseApiKey(req.headers[API_KEY_HEADER]);

  if (!apiKey || !safeEquals(apiKey, env.CRUD_API_KEY)) {
    next(new UnauthorizedError("CRUD API key ausente ou invalida"));
    return;
  }

  next();
};
