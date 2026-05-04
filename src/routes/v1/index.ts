import { Router } from "express";
import { mensagensRouter } from "../../modules/mensagens/routes";
import { tenantsRouter } from "../../modules/tenants/routes";
import { authApiKeyMiddleware } from "../../shared/middleware/auth-api-key";
import { authCrudApiKeyMiddleware } from "../../shared/middleware/auth-crud-api-key";
import type { RequestWithId } from "../../shared/middleware/request-id";
import { getQueueSnapshot } from "../../shared/queue/queue-factory";

const v1Router = Router();

//Rota para verificar a fila atual
v1Router.get("/fila-atual", authApiKeyMiddleware, async (req, res) => {
  const typedRequest = req as RequestWithId;
  const queue = await getQueueSnapshot();

  res.status(200).json({
    requestId: typedRequest.requestId ?? null,
    queue,
    type: "testHealth",
  });
});

//Rota para envio de mensagens de texto
v1Router.use("/mensagens", authApiKeyMiddleware, mensagensRouter);
v1Router.use("/tenants", authCrudApiKeyMiddleware, tenantsRouter);

export { v1Router };
