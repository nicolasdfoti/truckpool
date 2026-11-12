/**
 * Validación de arranque.
 *
 * El server arranca con variables que, si faltan, lo dejan escuchando igual pero
 * inútil o —peor— inseguro. Estas comprobaciones corren una vez, en el
 * entrypoint, antes de `app.listen`, para que un despliegue mal configurado
 * falle ruidosamente en vez de servir requests.
 */

import { AppError } from "./errors.js";
import { isLocalUrl } from "./urls.js";

/**
 * El secreto de desarrollo que antes estaba hardcodeado en `lib/auth.ts`.
 * Ya no se usa para firmar nada: queda sólo para detectar que alguien copió un
 * `.env` viejo y lo está usando en serio. Si aparece, el proceso aborta.
 */
export const LEGACY_DEV_SECRET = "dev-secret-change-me";

/**
 * Los valores con los que puede arrancar el server. "test" queda afuera a
 * propósito: lo pone vitest, que no pasa por src/index.ts, y en un server de
 * verdad apagaría los rate limits de login (`lib/rateLimit.ts`).
 */
const KNOWN_NODE_ENVS: readonly string[] = ["development", "production"];

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
 * MP_OAUTH_TEST_TOKEN: si el intercambio OAuth de Mercado Pago pide
 * credenciales de sandbox (`test_token=true` en /oauth/token, como indica la
 * doc de MP). Se activa solo con esta variable, nunca por NODE_ENV: NODE_ENV
 * solo la traba, porque en producción no se acepta. Valores: "true", "false"
 * o vacío (= false). Cualquier otro valor es un error: un typo no puede elegir
 * el modo en silencio.
 */
function readMpOAuthTestToken(): { enabled: boolean; problem?: string } {
  return readSandboxFlag(
    "MP_OAUTH_TEST_TOKEN",
    "pide credenciales de sandbox de Mercado Pago"
  );
}

/**
 * Lee una bandera de sandbox de Mercado Pago: "true", "false" o vacío (= false).
 * Otro valor es un problema, y "true" con NODE_ENV=production también.
 */
function readSandboxFlag(
  name: string,
  what: string
): { enabled: boolean; problem?: string } {
  const raw = process.env[name];
  if (raw === undefined || raw === "" || raw === "false") return { enabled: false };
  if (raw !== "true") {
    return { enabled: false, problem: `${name}="${raw}" no es válido: usá true o false` };
  }
  if (process.env.NODE_ENV === "production") {
    return {
      enabled: false,
      problem: `${name}=true ${what}: no se puede usar en producción`,
    };
  }
  return { enabled: true };
}

/**
 * `MP_CHECKOUT_SANDBOX`: si el checkout de la seña y del saldo manda al link de
 * sandbox (`sandbox_init_point`) en vez del real (`init_point`). MP devuelve los
 * dos, así que elegir no puede depender de cuál venga: con credenciales reales,
 * el de sandbox mandaría un pago real al sandbox. Por defecto false.
 */
function readMpCheckoutSandbox(): { enabled: boolean; problem?: string } {
  return readSandboxFlag(
    "MP_CHECKOUT_SANDBOX",
    "manda el checkout al sandbox de Mercado Pago"
  );
}

/** Para crear la preference. Repite la traba de producción del arranque. */
export function mpCheckoutSandbox(): boolean {
  const { enabled, problem } = readMpCheckoutSandbox();
  if (problem) throw new AppError(problem, 500, "MP_NOT_CONFIGURED");
  return enabled;
}

/**
 * Para el intercambio OAuth. Repite la traba de producción además del chequeo
 * de arranque: aunque algo se saltee assertServerEnv, en producción nunca se
 * piden credenciales de sandbox.
 */
export function mpOAuthTestToken(): boolean {
  const { enabled, problem } = readMpOAuthTestToken();
  if (problem) throw new AppError(problem, 500, "MP_NOT_CONFIGURED");
  return enabled;
}

/**
 * `JOBS_ENABLED`: si arrancan las tareas periódicas (lib/jobs.ts). Valores:
 * "true", "false" o vacío (= prendidas, el default de siempre). Otro valor es
 * un error: con un typo los jobs quedaban prendidos en silencio, devolviendo
 * señas y conciliando pagos contra la base de desarrollo.
 */
function readJobsEnabled(): { enabled: boolean; problem?: string } {
  const raw = process.env.JOBS_ENABLED;
  if (raw === undefined || raw === "" || raw === "true") return { enabled: true };
  if (raw === "false") return { enabled: false };
  return {
    enabled: false,
    problem: `JOBS_ENABLED="${raw}" no es válido: usá true o false`,
  };
}

/**
 * Para src/index.ts, después de assertServerEnv: si arrancan los jobs y la
 * línea que lo deja dicho en el log de arranque.
 */
export function jobsStatus(): { enabled: boolean; message: string } {
  const { enabled, problem } = readJobsEnabled();
  if (problem) throw new EnvError([problem]);
  return enabled
    ? { enabled, message: "jobs prendidos (JOBS_ENABLED=true o sin definir)" }
    : { enabled, message: "jobs apagados (JOBS_ENABLED=false)" };
}

/**
 * `TRUST_PROXY`: cuántos proxies hay delante de la API (lib/security.ts). Un
 * entero ≥ 0, "true" (= 1) o "false" (= 0). Otro valor es un error en cualquier
 * entorno: antes caía a "sin proxy" en silencio.
 */
function trustProxyProblem(): string | undefined {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === "") return undefined;
  if (/^(\d+|true|false)$/.test(raw)) return undefined;
  return `TRUST_PROXY="${raw}" no es válido: usá la cantidad de proxies delante de la API (0, 1, 2…)`;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * Lo que producción exige además de lo de siempre (02§2.6). Sin esto el server
 * arrancaba y fallaba recién al usarlo (webhooks en 503, OAuth y emails sin
 * configurar) o quedaba abierto (CORS a cualquier origen).
 */
function productionProblems(): string[] {
  const problems: string[] = [];

  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    problems.push(
      "TOKEN_ENCRYPTION_KEY tiene que ser 64 caracteres hex (32 bytes): sin ella no se guardan los tokens de Mercado Pago. Generala con `openssl rand -hex 32`"
    );
  }

  const required: [string, string][] = [
    [
      "MP_WEBHOOK_SECRET",
      "sin él el webhook de Mercado Pago responde 503 y ningún pago se acredita",
    ],
    ["MP_CLIENT_ID", "sin él ningún fletero puede conectar su cuenta de Mercado Pago"],
    [
      "MP_CLIENT_SECRET",
      "sin él ningún fletero puede conectar su cuenta de Mercado Pago",
    ],
    ["RESEND_API_KEY", "sin ella no sale ningún email"],
    [
      "TRUST_PROXY",
      "tiene que ser la cantidad de proxies delante de la API en el hosting (0 si no hay ninguno)",
    ],
  ];
  for (const [name, why] of required) {
    if (isBlank(process.env[name])) problems.push(`${name} no está definido: ${why}`);
  }

  const origins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    problems.push(
      "CORS_ORIGIN no está definido: tiene que listar el origen del front (sin él la API quedaría abierta a cualquier sitio)"
    );
  } else if (origins.includes("*")) {
    problems.push('CORS_ORIGIN no puede incluir "*": listá los orígenes del front');
  }

  // Con APP_URL local, la preference no manda back_urls (MP las rechaza): el
  // comprador no volvería nunca al sitio después de pagar. API_PUBLIC_URL es la
  // notification_url del webhook y el redirect de OAuth: MP no llega a localhost.
  for (const name of ["APP_URL", "API_PUBLIC_URL"]) {
    const url = process.env[name]?.trim();
    if (!url || isLocalUrl(url) || !url.startsWith("https://")) {
      problems.push(
        `${name} tiene que ser una URL pública con https en producción (no localhost): Mercado Pago no acepta URLs locales`
      );
    }
  }

  return problems;
}

/**
 * Aborta el arranque si la configuración no alcanza para operar.
 *
 * Sólo chequea lo que rompería la seguridad o dejaría el server sin poder hacer
 * su trabajo. Fuera de producción, Mercado Pago, el correo y Nominatim siguen
 * siendo opcionales: cada módulo falla solo cuando se lo usa. En producción
 * son obligatorios (productionProblems).
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

  // Sin NODE_ENV (o con un typo como "prod") el server se cree fuera de
  // producción: monta los diagnósticos de Mercado Pago y abre CORS a localhost.
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === undefined || nodeEnv.trim() === "") {
    problems.push(
      "NODE_ENV no está definido. Ponelo explícito: `production` en el despliegue, `development` en server/.env"
    );
  } else if (nodeEnv === "test") {
    problems.push(
      'NODE_ENV="test" es solo para correr los tests: apaga los rate limits de login. Usá `development` o `production`'
    );
  } else if (!KNOWN_NODE_ENVS.includes(nodeEnv)) {
    problems.push(
      `NODE_ENV="${nodeEnv}" no es un valor conocido (${KNOWN_NODE_ENVS.join(", ")})`
    );
  }

  if (nodeEnv === "production") problems.push(...productionProblems());

  const trustProxy = trustProxyProblem();
  if (trustProxy) problems.push(trustProxy);

  const mpTestToken = readMpOAuthTestToken();
  if (mpTestToken.problem) problems.push(mpTestToken.problem);
  const checkoutSandbox = readMpCheckoutSandbox();
  if (checkoutSandbox.problem) problems.push(checkoutSandbox.problem);
  const jobs = readJobsEnabled();
  if (jobs.problem) problems.push(jobs.problem);

  if (problems.length > 0) {
    throw new EnvError(problems);
  }
}
