import type { Request, Response } from "express";
import type { PostMensagemDocumentoInput } from "./schema-documento";
import { MensagensDocumentoService } from "./service-documento";
import { RequestWithId } from "../../../shared/middleware/request-id";
import type { RequestWithMessageAuth } from "../../../shared/middleware/auth-api-key";

export class MensagensDocumentoController {
  public constructor(private readonly service: MensagensDocumentoService) {}

  public postMensagemDocumento = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const typedRequest = req as RequestWithId &
      RequestWithMessageAuth & {
      body: PostMensagemDocumentoInput;
    };
    const response = await this.service.enfileirarMensagemDocumento(
      typedRequest.requestId,
      typedRequest.body,
      typedRequest.authContext,
    );

    res.status(202).json(response);
  };
}
