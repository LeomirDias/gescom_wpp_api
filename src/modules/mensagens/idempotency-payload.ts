import { createHash } from "node:crypto";
import type { PostMensagemTextoInput } from "./mensagem-texto/schema";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const stableFingerprintObject = (parts: Record<string, string>): string => {
  const keys = Object.keys(parts).sort();
  const ordered: Record<string, string> = {};
  for (const key of keys) {
    ordered[key] = parts[key];
  }
  return sha256Hex(JSON.stringify(ordered));
};

export const fingerprintMensagemTexto = (input: PostMensagemTextoInput): string =>
  stableFingerprintObject({
    to: input.to,
    message: input.message,
  });

export const fingerprintMensagemDocumentoItem = (
  to: string,
  caption: string,
  resolvedFilename: string,
  fileBuffer: Buffer,
): string => {
  const fileSha256 = createHash("sha256").update(fileBuffer).digest("hex");
  return stableFingerprintObject({
    to,
    caption,
    filename: resolvedFilename,
    fileSha256,
  });
};
