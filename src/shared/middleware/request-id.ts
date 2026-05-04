import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

const parseRequestIdHeader = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const parsedValue = value.trim();

  if (!REQUEST_ID_REGEX.test(parsedValue)) {
    return null;
  }

  return parsedValue;
};

export type RequestWithId = Request & { requestId: string };

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incomingRequestId = parseRequestIdHeader(req.headers[REQUEST_ID_HEADER]);
  const requestId = incomingRequestId ?? randomUUID();

  const request = req as RequestWithId;

  request.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
};
