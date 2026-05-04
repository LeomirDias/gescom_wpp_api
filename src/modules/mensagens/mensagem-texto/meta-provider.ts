import type { AxiosInstance } from "axios";
import {
  buildMetaMessagesPath,
  metaHttpClient,
} from "../../../shared/http/meta-http-client";
import type { SendTextMessageJobPayload } from "../../../shared/queue/queue-connection.interface";
import {
  fromMetaSendMessageResponse,
  toMetaTextMessagePayload,
  type MetaSendMessageResponse,
  type SendTextMessageResult,
} from "./mapper";

/**
 * Provider responsavel por isolar detalhes da Meta (rota, headers de correlacao
 * e desempacotamento de resposta) para que o `service` e `worker` trabalhem apenas
 * com o modelo de dominio.
 */

export class MetaProvider {
  public constructor(
    private readonly client: AxiosInstance = metaHttpClient,
  ) {}

  public async sendTextMessage(
    job: SendTextMessageJobPayload,
  ): Promise<SendTextMessageResult> {
    const url = buildMetaMessagesPath(job.metaPhoneNumberId);
    const payload = toMetaTextMessagePayload(job);

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

    return fromMetaSendMessageResponse(response.data);
  }
}

export const metaProvider = new MetaProvider();
