import cors, { type CorsOptions } from "cors";
import { env } from "./env";

const csvToOrigins = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

const corsOrigins = csvToOrigins(env.CORS_ORIGINS);

const corsOptions: CorsOptions =
  env.NODE_ENV === "production"
    ? {
        origin: (origin, callback) => {
          if (!origin) {
            callback(null, true);
            return;
          }

          callback(null, corsOrigins.includes(origin));
        },
      }
    : {
        origin: true,
      };

const JSON_BODY_LIMIT = env.JSON_BODY_LIMIT;

export const corsMiddleware = cors(corsOptions);
export const jsonBodyParser = { limit: JSON_BODY_LIMIT };
