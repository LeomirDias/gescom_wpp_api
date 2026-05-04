import { Router } from "express";
import { v1Router } from "./v1";

const apiRouter = Router();

//Rota para versao 1 da API
apiRouter.use("/v1", v1Router);

export { apiRouter };
