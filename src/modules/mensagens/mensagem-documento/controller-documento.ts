import type { Request, Response } from "express";
import type { PostMensagemDocumentoInput } from "./schema-documento";
import { MensagensDocumentoService } from "./service-documento";
import { RequestWithId } from "../../../shared/middleware/request-id";
import type { RequestWithMessageAuth } from "../../../shared/middleware/auth-api-key";
import { ValidationError } from "../../../shared/errors/app-error";
import { FILE_FIELD_NAME } from "../../../shared/middleware/upload-document";

export class MensagensDocumentoController {
  public constructor(private readonly service: MensagensDocumentoService) {}

  public postMensagemDocumento = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const typedRequest = req as RequestWithId &
      RequestWithMessageAuth & {
        body: PostMensagemDocumentoInput;
        file?: Express.Multer.File;
      };

    const file = typedRequest.file;
    if (!file) {
      throw new ValidationError([
        {
          path: FILE_FIELD_NAME,
          message:
            "Campo 'file' (arquivo do documento) e obrigatorio no multipart/form-data",
        },
      ]);
    }

    const response = await this.service.enfileirarMensagemDocumento(
      typedRequest.requestId,
      typedRequest.body,
      {
        buffer: file.buffer,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
      typedRequest.authContext,
    );

    res.status(202).json(response);
  };
}
