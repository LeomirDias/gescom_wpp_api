import { Router } from "express";
import { validateSchema } from "../../shared/middleware/validate-schema";
import { MensagensController } from "./mensagem-texto/controller";
import { MensagensDocumentoController } from "./mensagem-documento/controller-documento";
import { postMensagemTextoSchema } from "./mensagem-texto/schema";
import { postMensagemDocumentoSchema } from "./mensagem-documento/schema-documento";
import { MensagensService } from "./mensagem-texto/service";
import { MensagensDocumentoService } from "./mensagem-documento/service-documento";

const mensagensRouter = Router();
const mensagensController = new MensagensController(new MensagensService());
const mensagensDocumentoController = new MensagensDocumentoController(
  new MensagensDocumentoService(),
);

mensagensRouter.post(
  "/texto",
  validateSchema(postMensagemTextoSchema),
  mensagensController.postMensagemTexto,
);

mensagensRouter.post(
  "/documento",
  validateSchema(postMensagemDocumentoSchema),
  mensagensDocumentoController.postMensagemDocumento,
);

export { mensagensRouter };
