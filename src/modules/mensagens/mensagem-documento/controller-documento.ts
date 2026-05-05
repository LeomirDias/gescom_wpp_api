import type { Request, Response } from "express";
import type { PostMensagemDocumentoBatchInput } from "./schema-documento";
import { MensagensDocumentoService } from "./service-documento";
import { RequestWithId } from "../../../shared/middleware/request-id";
import type { RequestWithMessageAuth } from "../../../shared/middleware/auth-api-key";
import { ValidationError } from "../../../shared/errors/app-error";
import { FILES_FIELD_NAME } from "../../../shared/middleware/upload-document";

export class MensagensDocumentoController {
  public constructor(private readonly service: MensagensDocumentoService) {}

  public postMensagemDocumento = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const typedRequest = req as RequestWithId &
      RequestWithMessageAuth & {
        body: PostMensagemDocumentoBatchInput;
        files?: Express.Multer.File[];
      };

    const files = typedRequest.files ?? [];

    if (files.length === 0) {
      throw new ValidationError([
        {
          path: FILES_FIELD_NAME,
          message:
            "Campo 'files' (arquivos dos documentos) e obrigatorio no multipart/form-data",
        },
      ]);
    }

    if (files.length !== typedRequest.body.documents.length) {
      throw new ValidationError([
        {
          path: FILES_FIELD_NAME,
          message: `Numero de arquivos (${files.length}) nao corresponde ao numero de itens em 'documents' (${typedRequest.body.documents.length})`,
        },
      ]);
    }

    const uploads = files.map((file) => ({
      buffer: file.buffer,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    }));

    const response = await this.service.enfileirarMensagemDocumentoBatch(
      typedRequest.requestId,
      typedRequest.body,
      uploads,
      typedRequest.authContext,
    );

    res.status(202).json(response);
  };
}
