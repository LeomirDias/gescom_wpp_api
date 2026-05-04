import type { AxiosInstance } from "axios";
import { readFile } from "node:fs/promises";
import {
  buildMetaMediaPath,
  buildMetaMessagesPath,
  metaHttpClient,
} from "../../../shared/http/meta-http-client";
import type { SendDocumentMessageJobPayload } from "../../../shared/queue/queue-connection.interface";
import type { LocalDocumentFile } from "./document-local-file";
import {
  fromMetaSendDocumentMessageResponse,
  toMetaDocumentMessagePayload,
  type MetaSendMessageResponse,
  type SendDocumentMessageResult,
} from "./mapper-documento";

type MetaMediaUploadResponse = {
  id: string;
};

/**
 * Provider responsavel por isolar detalhes da Meta (rota, headers de correlacao
 * e desempacotamento de resposta) para o fluxo de envio de mensagens com
 * documento, mantendo `service` e `worker` livres do contrato externo.
 */

export class MetaDocumentProvider {
  public constructor(
    private readonly client: AxiosInstance = metaHttpClient,
  ) {}

  public async sendDocumentMessage(
    job: SendDocumentMessageJobPayload,
    localDocument: LocalDocumentFile,
  ): Promise<SendDocumentMessageResult> {
    const mediaId = await this.uploadDocumentMedia(job, localDocument);
    const url = buildMetaMessagesPath(job.metaPhoneNumberId);
    const payload = toMetaDocumentMessagePayload(job, mediaId);

    const response = await this.client.post<MetaSendMessageResponse>(
      url,
      payload,
      {
        headers: {
          "x-request-id": job.requestId,
          "x-job-id": job.jobId,
        },
      },
    );

    return fromMetaSendDocumentMessageResponse(response.data);
  }

  private async uploadDocumentMedia(
    job: SendDocumentMessageJobPayload,
    localDocument: LocalDocumentFile,
  ): Promise<string> {
    const mediaUrl = buildMetaMediaPath(job.metaPhoneNumberId);
    const fileBuffer = await readFile(localDocument.path);
    const form = new FormData();

    form.append("messaging_product", "whatsapp");
    form.append("type", localDocument.mimeType);
    form.append(
      "file",
      new Blob([fileBuffer], { type: localDocument.mimeType }),
      localDocument.filename,
    );

    const response = await this.client.post<MetaMediaUploadResponse>(
      mediaUrl,
      form,
      {
        headers: {
          "x-request-id": job.requestId,
          "x-job-id": job.jobId,
        },
      },
    );

    return response.data.id;
  }
}

export const metaDocumentProvider = new MetaDocumentProvider();
