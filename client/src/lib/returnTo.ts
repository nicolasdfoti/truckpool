/**
 * RD8: a dónde vuelve el login. `/ingresar?volver=/viajes/abc` lleva a la
 * página desde la que se fue a ingresar (el viaje que se iba a reservar, el
 * retorno del pago).
 *
 * Solo rutas internas: una ruta que empieza con una sola «/». «//otro.sitio» y
 * «/\otro.sitio» el navegador los toma como otro dominio, y una URL absoluta
 * haría del login una redirección abierta. El inicio y el propio login no
 * cuentan: ahí sigue el destino de siempre según el rol.
 */
export function safeReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (raw === "/" || raw.startsWith("/ingresar")) return null;
  return raw;
}

/** el link a /ingresar que vuelve a `returnTo` (más tab/role si hacen falta) */
export function loginHref(returnTo: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  const target = safeReturnTo(returnTo);
  if (target) query.set("volver", target);
  const qs = query.toString();
  return qs ? `/ingresar?${qs}` : "/ingresar";
}
