import express from "express";
import helmet from "helmet";
import { appInfo } from "./config/app-info";
import { corsMiddleware, jsonBodyParser } from "./config/http";
import { errorHandler } from "./shared/errors/error-handler";
import { requestIdMiddleware } from "./shared/middleware/request-id";
import { apiRouter } from "./routes";

const app = express();

app.use(helmet());
app.use(corsMiddleware);
app.use(express.json(jsonBodyParser));
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
