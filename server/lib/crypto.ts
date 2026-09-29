import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors.js";

/**
 * Cifrado de secretos de terceros (access tokens de Mercado Pago) con
 * AES-256-GCM. El token de un transportista es plata ajena: si alguien lee la
 * base puede withdrawing a nombre de ese transportista.
 *
 * La clave vive en TOKEN_ENCRYPTION_KEY como 64 hex chars (32 bytes). No hay
 * default: si falta, el error es explícito y ruidoso, nunca un cifrado débil.
 *
 * Lo que se guarda en la base no es el token sino un sobre:
 *   v1:<iv base64>:<tag base64>:<cifrado base64>
 * El prefijo de versión permite detectar valores viejos en claro y fallar en
 * vez de devolver basura silenciosamente.
 */
const PREFIX = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function encryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new AppError(
      "falta TOKEN_ENCRYPTION_KEY: no se pueden guardar tokens de Mercado Pago",
      503,
      "TOKEN_ENCRYPTION_KEY_MISSING"
    );
  }
  const key = Buffer.from(raw.trim(), "hex");
  if (key.length !== 32) {
    throw new AppError(
      "TOKEN_ENCRYPTION_KEY tiene que ser 64 caracteres hex (32 bytes)",
      503,
      "TOKEN_ENCRYPTION_KEY_INVALID"
    );
  }
  return key;
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    PREFIX,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored: string): string {
  if (!isEncryptedSecret(stored)) {
    // Un token guardado antes de esto quedó en claro. Fallar acá es lo
    // correcto: devolverlo "como si nada" seguiría exponiéndolo, y volver a
    // cifrar algo que no se puede leer es inventar datos.
    throw new AppError(
      "el token de Mercado Pago guardado no está cifrado: hay que volver a conectar la cuenta",
      409,
      "MP_TOKEN_NOT_ENCRYPTED"
    );
  }
  const [, ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new AppError(
      "el token de Mercado Pago guardado está corrupto",
      500,
      "MP_TOKEN_DECRYPT_FAILED"
    );
  }
  try {
    const decipher = createDecipheriv(
      ALGO,
      encryptionKey(),
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // La clave cambió o el sobre está corrupto: nunca devolvemos un token
    // medio leido contra la API de Mercado Pago.
    throw new AppError(
      "no pudimos descifrar el token de Mercado Pago: revisá TOKEN_ENCRYPTION_KEY",
      500,
      "MP_TOKEN_DECRYPT_FAILED"
    );
  }
}
