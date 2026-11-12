// Entorno fijo para los tests. No se carga el .env: los tests no pueden
// depender del .env ni de la shell de quien los corre. Con una URL de túnel en
// API_PUBLIC_URL, por ejemplo, fallaban los tests de la notification_url.
//
// Cada variable que lee el código se fija acá o se borra, así rige el valor por
// defecto del código. Un test que necesita otro valor lo pone él mismo (y lo
// restaura). Si el código empieza a leer una variable nueva, se agrega acá.

// fijas: valores conocidos que los tests asumen
const FIJAS: Record<string, string> = {
  NODE_ENV: "test",
  // los tests mockean Prisma: una base inexistente garantiza que un mock que
  // falte no termine escribiendo en la base local de desarrollo
  DATABASE_URL: "postgresql://tests:tests@127.0.0.1:1/truckpool_tests",
  // los tokens de Mercado Pago que usan los mocks tienen que poder cifrarse y
  // descifrarse de verdad, no con un stub
  TOKEN_ENCRYPTION_KEY:
    "0000000000000000000000000000000000000000000000000000000000000001",
  // si cambia, los tokens que firman los tests dejan de coincidir con los que
  // verifica el código y el fallo es incomprensible
  JWT_SECRET: "secreto-de-sesion-fijo-para-los-tests-nunca-usar-en-produccion",
};

// borradas: rige el valor por defecto del código (localhost, sin MP, sin
// emails, sin proxy, límites por defecto)
const BORRADAS = [
  "PORT",
  "API_PREFIX",
  "CORS_ORIGIN",
  "APP_URL",
  "API_PUBLIC_URL",
  "MP_ACCESS_TOKEN",
  "MP_WEBHOOK_SECRET",
  "MP_CLIENT_ID",
  "MP_CLIENT_SECRET",
  "MP_OAUTH_TEST_TOKEN",
  "MP_CHECKOUT_SANDBOX",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "NOMINATIM_URL",
  "NOMINATIM_USER_AGENT",
  "TRUST_PROXY",
  "AUTH_RATE_LIMIT_MAX",
  "MAX_STOP_DISTANCE_FROM_ROUTE_KM",
  "JOBS_ENABLED",
];

for (const [nombre, valor] of Object.entries(FIJAS)) process.env[nombre] = valor;
for (const nombre of BORRADAS) delete process.env[nombre];

// Sin red: los tests mockean Nominatim, OSRM, Mercado Pago y Resend. Un test
// que igual intenta salir a internet tiene que fallar enseguida y con un
// mensaje claro, no depender de la red (así nació un test intermitente: un
// archivo sin el mock de lib/geocode.js le pegaba a Nominatim de verdad).
//
// Se corta en dos niveles: fetch (lo que usa el código) y la conexión TCP
// (cualquier otro cliente HTTP, como el SDK de Mercado Pago). Loopback queda
// permitido: supertest levanta la app en 127.0.0.1. Como el código de
// geocode y de emails atrapa los errores (son best-effort), el intento
// también se anota y el afterEach hace fallar al test que lo hizo.
import net from "node:net";
import { afterEach } from "vitest";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"]);
const intentosDeRed: string[] = [];

function bloquearRed(destino: string): never {
  intentosDeRed.push(destino);
  throw new Error(
    `los tests no salen a la red: se intentó conectar a ${destino}. ` +
      "mockeá el módulo que hace la llamada (vi.mock) o stubeá fetch (vi.stubGlobal)."
  );
}

const fetchReal = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!LOOPBACK.has(url.hostname)) bloquearRed(url.host);
  return fetchReal(input, init);
}) as typeof fetch;

/** el host al que va una llamada a Socket#connect (null: socket unix) */
function hostDeConexion(args: unknown[]): string | null {
  // net.connect() le pasa los argumentos ya normalizados: [opciones, callback]
  const primero = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof primero === "object" && primero !== null) {
    const opciones = primero as { host?: string; path?: string };
    if (opciones.path) return null;
    return opciones.host ?? "localhost";
  }
  if (typeof primero === "number") {
    return typeof args[1] === "string" ? args[1] : "localhost";
  }
  return null;
}

const connectReal = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const host = hostDeConexion(args);
  if (host !== null && !LOOPBACK.has(host)) bloquearRed(host);
  return connectReal.apply(this, args as Parameters<typeof connectReal>);
} as typeof connectReal;

afterEach(() => {
  if (intentosDeRed.length === 0) return;
  const destinos = [...new Set(intentosDeRed)].join(", ");
  intentosDeRed.length = 0;
  throw new Error(
    `el test intentó salir a la red (${destinos}); el error se pudo haber atrapado ` +
      "en el código (geocode y emails son best-effort). mockeá esa llamada."
  );
});
