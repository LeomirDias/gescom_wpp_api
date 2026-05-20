import type { AxiosInstance } from "axios";
import {
  buildMetaMediaPath,
  buildMetaMessagesPath,
  metaHttpClient,
} from "../../../shared/http/meta-http-client";
import type { SendDocumentMessageJobPayload } from "../../../shared/queue/queue-connection.interface";
import type { LoadedDocument } from "./storage-documento";
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
    document: LoadedDocument,
  ): Promise<SendDocumentMessageResult> {
    const mediaId = await this.uploadDocumentMedia(job, document);
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
    document: LoadedDocument,
  ): Promise<string> {
    const mediaUrl = buildMetaMediaPath(job.metaPhoneNumberId);
    const form = new FormData();

    const standaloneBuffer = new ArrayBuffer(document.buffer.byteLength);
    new Uint8Array(standaloneBuffer).set(document.buffer);

    form.append("messaging_product", "whatsapp");
    form.append("type", document.mimeType);
    form.append(
      "file",
      new Blob([standaloneBuffer], { type: document.mimeType }),
      job.document.filename,
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

    const mediaId = response.data?.id?.trim();
    if (!mediaId) {
      throw new Error("Resposta da Meta upload nao contem media id");
    }

    return mediaId;
  }
}

export const metaDocumentProvider = new MetaDocumentProvider();
