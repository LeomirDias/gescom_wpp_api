import { Router } from "express";
import { validateSchema } from "../../shared/middleware/validate-schema";
import { MensagensController } from "./mensagem-texto/controller";
import { MensagensDocumentoController } from "./mensagem-documento/controller-documento";
import { postMensagemTextoSchema } from "./mensagem-texto/schema";
import { postMensagemDocumentoBatchSchema } from "./mensagem-documento/schema-documento";
import { MensagensService } from "./mensagem-texto/service";
import { MensagensDocumentoService } from "./mensagem-documento/service-documento";
import { uploadDocumentMiddleware } from "../../shared/middleware/upload-document";
import { parseMultipartPayload } from "../../shared/middleware/parse-multipart-payload";

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
  uploadDocumentMiddleware,
  parseMultipartPayload,
  validateSchema(postMensagemDocumentoBatchSchema),
  mensagensDocumentoController.postMensagemDocumento,
);

export { mensagensRouter };
