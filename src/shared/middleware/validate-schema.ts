import type { NextFunction, Request, Response } from "express";
import type { ZodIssue, ZodType } from "zod";
import { ValidationError } from "../errors/app-error";

type ValidationIssue = {
  path: string;
  message: string;
};

const mapIssuePath = (issue: ZodIssue): string => {
  if (!issue.path.length) {
    return "body";
  }

  return issue.path.join(".");
};

const mapIssues = (issues: ZodIssue[]): ValidationIssue[] =>
  issues.map((issue) => ({
    path: mapIssuePath(issue),
    message: issue.message,
  }));

export const validateSchema =
  <TOutput>(schema: ZodType<TOutput>) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const parsedBody = schema.safeParse(req.body);

    if (!parsedBody.success) {
      next(new ValidationError(mapIssues(parsedBody.error.issues)));
      return;
    }

    req.body = parsedBody.data;
    next();
  };
