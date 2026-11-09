/**
 * Si una URL apunta a la propia máquina: localhost, *.localhost, 127.0.0.0/8,
 * ::1 o 0.0.0.0. Mercado Pago no acepta esas URLs en `back_urls` (doc: «No
 * utilices dominios locales en el valor `back_urls`»): con `auto_return` la
 * preference falla con 400 "auto_return invalid. back_url.success must be
 * defined", visto en sandbox.
 *
 * Una URL que no se puede parsear cuenta como local: tampoco le sirve a MP.
 */
export function isLocalUrl(raw: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(raw).hostname.toLowerCase();
  } catch {
    return true;
  }
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}
