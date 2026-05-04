import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const csvStringToList = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1))
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(z.string()).min(1));

const stringToBoolean = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(["true", "false"]))
  .transform((value) => value === "true");

const envSchema = z
  .object({
    NODE_ENV: z
      .string()
      .transform((value) => value.trim().toLowerCase())
      .pipe(z.enum(["development", "test", "production"]))
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CRUD_API_KEY: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1)),
    META_API_BASE_URL: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().url()),
    META_ACCESS_TOKEN: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1)),
    QUEUE_DRIVER: z
      .string()
      .transform((value) => value.trim().toLowerCase())
      .pipe(z.enum(["memory", "redis"])),
    LOCAL_QUEUE_PREFIX: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1)),
    QUEUE_PREFIX: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1)),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive(),
    RATE_LIMIT_MAX: z.coerce.number().int().positive(),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive(),
    IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive().default(600000),
    IDEMPOTENCY_CLEANUP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),
    QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    DEAD_LETTER_RETENTION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(86400000),
    CORS_ORIGINS: z
      .string()
      .transform((value) => value.trim())
      .optional(),
    // Condicionais - Redis será implementado futuramente
    REDIS_HOST: z
      .string()
      .transform((value) => value.trim())
      .default("127.0.0.1"),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z
      .string()
      .transform((value) => value.trim())
      .optional(),
    REDIS_URL: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().url())
      .optional(),
    AUDIT_ENABLED: stringToBoolean.default(true),
    AUDIT_REDIS_PREFIX: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1))
      .default("audit"),
    AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    AUDIT_CLEANUP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),

    // Database config
    DRIZZLE_DATABASE_URL: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().url()),
    DATABASE_URL: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().url()),
  })
  .superRefine((env, context) => {
    if (env.QUEUE_DRIVER !== "redis") {
      return;
    }

    const hasRedisUrl = Boolean(env.REDIS_URL);
    const hasRedisHostPort = Boolean(env.REDIS_HOST) && Boolean(env.REDIS_PORT);

    if (!hasRedisUrl && !hasRedisHostPort) {
      context.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message:
          "When QUEUE_DRIVER=redis, provide REDIS_URL or both REDIS_HOST and REDIS_PORT",
      });
      return;
    }

    if (env.AUDIT_RETENTION_DAYS !== 30) {
      context.addIssue({
        code: "custom",
        path: ["AUDIT_RETENTION_DAYS"],
        message: "AUDIT_RETENTION_DAYS must be 30",
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const errors = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment variables: ${errors}`);
}

export const env = parsedEnv.data;
export type Env = z.infer<typeof envSchema>;
