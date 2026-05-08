import express from "express";
import helmet from "helmet";
import { appInfo } from "./config/app-info";
import { corsMiddleware, jsonBodyParser } from "./config/http";
import { errorHandler } from "./shared/errors/error-handler";
import { requestIdMiddleware } from "./shared/middleware/request-id";
import { apiRouter } from "./routes";

const app = express();
const isJsonContentType = (contentType: string | undefined): boolean => {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
};

app.use(helmet());
app.use(corsMiddleware);
app.use(
  express.json({
    ...jsonBodyParser,
    type: (req) => isJsonContentType(req.headers["content-type"]),
  }),
);
app.use(requestIdMiddleware);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: appInfo.version,
    queueDriver: appInfo.queueDriver,
  });
});

app.use("/api", apiRouter);
app.use(errorHandler);

export { app };
