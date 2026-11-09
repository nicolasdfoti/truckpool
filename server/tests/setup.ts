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
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "NOMINATIM_URL",
  "NOMINATIM_USER_AGENT",
  "TRUST_PROXY",
  "AUTH_RATE_LIMIT_MAX",
  "MAX_STOP_DISTANCE_FROM_ROUTE_KM",
];

for (const [nombre, valor] of Object.entries(FIJAS)) process.env[nombre] = valor;
for (const nombre of BORRADAS) delete process.env[nombre];
