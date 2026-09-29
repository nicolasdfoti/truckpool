/**
 * Validación de arranque.
 *
 * El server arranca con variables que, si faltan, lo dejan escuchando igual pero
 * inútil o —peor— inseguro. Estas comprobaciones corren una vez, en el
 * entrypoint, antes de `app.listen`, para que un despliegue mal configurado
 * falle ruidosamente en vez de servir requests.
 */

/**
 * El secreto de desarrollo que antes estaba hardcodeado en `lib/auth.ts`.
 * Ya no se usa para firmar nada: queda sólo para detectar que alguien copió un
 * `.env` viejo y lo está usando en serio. Si aparece, el proceso aborta.
 */
export const LEGACY_DEV_SECRET = "dev-secret-change-me";

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `faltan variables de entorno para arrancar:\n${problems
        .map((p) => `  - ${p}`)
        .join("\n")}`
    );
    this.name = "EnvError";
  }
}

/**
 * Aborta el arranque si la configuración no alcanza para operar.
 *
 * Sólo chequea lo que rompería la seguridad o dejaría el server sin poder hacer
 * su trabajo. Lo opcional (Mercado Pago, correo, Nominatim) sigue siendo
 * opcional a propósito: cada módulo falla solo cuando se lo usa.
 */
export function assertServerEnv(): void {
  const problems: string[] = [];

  const secret = process.env.JWT_SECRET;
  if (secret === undefined || secret.trim() === "") {
    problems.push(
      "JWT_SECRET no está definido. Generá uno con `openssl rand -hex 32` y ponelo en server/.env"
    );
  } else if (secret === LEGACY_DEV_SECRET) {
    problems.push(
      `JWT_SECRET es el valor de desarrollo que estaba hardcodeado en el código (${LEGACY_DEV_SECRET}). ` +
        "Como estuvo en el fuente, tratalo como filtrado: generá uno nuevo con `openssl rand -hex 32`"
    );
  }

  if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL.trim() === "") {
    problems.push("DATABASE_URL no está definido. Sin él no hay base de datos.");
  }

  if (problems.length > 0) {
    throw new EnvError(problems);
  }
}
