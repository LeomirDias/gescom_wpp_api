export type ApiErrorDetails = Array<{
  path: string;
  message: string;
}>;

export interface ApiErrorResponse {
  requestId: string | null;
  code: string;
  message: string;
  details?: ApiErrorDetails;
}

type ApiErrorResponseInput = {
  requestId?: string | null;
  code: string;
  message: string;
  details?: ApiErrorDetails;
};

export const createApiErrorResponse = ({
  requestId = null,
  code,
  message,
  details,
}: ApiErrorResponseInput): ApiErrorResponse => {
  if (!details || details.length === 0) {
    return {
      requestId,
      code,
      message,
    };
  }

  return {
    requestId,
    code,
    message,
    details,
  };
};
