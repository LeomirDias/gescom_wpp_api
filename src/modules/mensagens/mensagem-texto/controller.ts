import type { Request, Response } from "express";
import type { RequestWithId } from "../../../shared/middleware/request-id";
import type { RequestWithMessageAuth } from "../../../shared/middleware/auth-api-key";
import type { PostMensagemTextoInput } from "./schema";
import { MensagensService } from "./service";

export class MensagensController {
  public constructor(private readonly service: MensagensService) {}

  public postMensagemTexto = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const typedRequest = req as RequestWithId &
      RequestWithMessageAuth & {
      body: PostMensagemTextoInput;
    };
    const response = await this.service.enfileirarMensagemTexto(
      typedRequest.requestId,
      typedRequest.body,
      typedRequest.authContext,
    );

    res.status(202).json(response);
  };
}
