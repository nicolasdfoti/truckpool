import { randomBytes } from "node:crypto";

/**
 * Códigos de seguimiento públicos (U9).
 *
 * Formato: `TP-XXXX-XXXX-XXXX-XXXX`, 16 caracteres en base32 Crockford = 80
 * bits aleatorios. El formato viejo (`TP-{últimos 4 del id del viaje}-C{n}`)
 * se podía adivinar recorriendo n; este no.
 *
 * Crockford deja afuera I, L, O y U para que el código se pueda dictar o
 * copiar a mano sin confundir letras con números.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const TRACKING_CODE_PATTERN =
  /^TP-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

/** largo máximo que se acepta buscar: el formato nuevo tiene 22 caracteres */
const MAX_INPUT_LENGTH = 40;

export function generateTrackingCode(): string {
  const bytes = randomBytes(10);
  // 80 bits → 16 grupos de 5 bits, del más significativo al menos
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let chars = "";
  for (let i = 15; i >= 0; i--) {
    chars += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  }
  const groups = [0, 4, 8, 12].map((start) => chars.slice(start, start + 4));
  return `TP-${groups.join("-")}`;
}

/** el formato nuevo, pero aceptando las letras que Crockford lee como números */
const NEW_FORMAT_LOOSE = /^TP-[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/;

/**
 * Normaliza lo que escribió el usuario: mayúsculas y sin espacios. En un
 * código con el formato nuevo, además, O se lee como 0 e I/L como 1 (regla
 * Crockford). Un código viejo se deja como está: ahí la O sale del id del
 * viaje y es una O de verdad.
 *
 * Devuelve null si no hay nada que buscar (vacío o más largo que cualquier
 * código posible).
 */
export function normalizeTrackingCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  if (code.length === 0 || code.length > MAX_INPUT_LENGTH) return null;
  if (!NEW_FORMAT_LOOSE.test(code)) return code;
  return "TP-" + code.slice(3).replace(/O/g, "0").replace(/[IL]/g, "1");
}
