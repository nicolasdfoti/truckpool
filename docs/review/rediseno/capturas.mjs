// Capturas de la comparación antes/después del rediseño (docs/review/rediseno).
// Mismo recorrido para main y para la rama, contra la misma API:
//
//   BASE_URL=http://localhost:5174 OUT=docs/review/rediseno/comparacion/antes   node docs/review/rediseno/capturas.mjs
//   BASE_URL=http://localhost:5175 OUT=docs/review/rediseno/comparacion/despues node docs/review/rediseno/capturas.mjs
//
// Variables:
//   BASE_URL  el front a capturar (obligatoria)
//   OUT       carpeta de salida, relativa a donde se corre (obligatoria)
//   API_URL   la API (default http://localhost:4000/api)
//   SOLO      pantallas separadas por coma (default: todas)
//   CAPTURAS_PASSWORD  contraseña de los usuarios del seed (default: la del seed
//             demo/e2e, que es pública y sólo existe fuera de producción)
//
// Antes de cada corrida: `npm run db:seed:e2e` en server/, para que las dos
// versiones vean los mismos datos. Usa el Playwright instalado en client/.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const { chromium } = require("playwright");

const base = process.env.BASE_URL;
const out = process.env.OUT;
const only = process.env.SOLO;
if (!base || !out) {
  console.error("uso: BASE_URL=http://localhost:5175 OUT=despues node capturas.mjs");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const API = process.env.API_URL ?? "http://localhost:4000/api";
const PASSWORD = process.env.CAPTURAS_PASSWORD ?? "truckpool123";

// En dev los fleteros del seed no tienen Mercado Pago conectado y GET /trips
// viene vacío (el listado sólo ofrece viajes que se pueden pagar). Las pantallas
// con `mock: true` responden GET /trips con estos viajes de ejemplo, iguales
// para las dos versiones; el resto va contra la API real.
const DAY = 86400000;
const day = (n) => new Date(Date.UTC(2026, 10, 13) + n * DAY).toISOString();
const trip = (id, origin, destination, n, time, truckType, total, used, price) => ({
  id,
  origin,
  destination,
  date: day(n),
  departureTime: time,
  truckType,
  capacityTotal: total,
  capacityUsed: used,
  price,
  status: "OPEN",
  acceptsCargo: true,
  carrierId: "ejemplo",
  carrierName: "Transportes de ejemplo",
  features: [],
  depositPercent: 20,
  platformFeePercent: 10,
});
const MOCK_TRIPS = [
  trip("ej-1", "Córdoba", "Mendoza", 9, "08:00", "Semi", 30, 14, 3000),
  trip("ej-2", "Buenos Aires", "Bahía Blanca", 10, "22:00", "Chasis", 18, 9, 1260),
  trip("ej-3", "Rosario", "Mendoza", 11, "06:00", "Semi", 30, 7, 2550),
  trip("ej-4", "Santa Fe", "Tucumán", 13, null, "Semi", 30, 18, 2850),
];

const SCREENS = [
  { id: "inicio", path: "/" },
  { id: "inicio-con-viajes", path: "/", mock: true },
  { id: "viajes-con-viajes", path: "/viajes", mock: true },
  { id: "viajes", path: "/viajes" },
  { id: "viajes-buscador", path: "/viajes?origen=C%C3%B3rdoba" },
  { id: "viaje-anonimo", path: "/viajes/e2e-trip-roles" },
  {
    id: "viaje-empresa",
    path: "/viajes/e2e-trip-lifecycle",
    user: "empresa@truckpool.app",
  },
  {
    id: "viaje-empresa-roles",
    path: "/viajes/e2e-trip-roles",
    user: "empresa@truckpool.app",
  },
  { id: "viaje-fletero", path: "/viajes/e2e-trip-roles", user: "flete@truckpool.app" },
  {
    id: "viaje-en-transito",
    path: "/viajes/e2e-trip-transit",
    user: "empresa@truckpool.app",
  },
  { id: "publicar", path: "/viajes/nuevo", user: "flete@truckpool.app" },
  { id: "ingresar", path: "/ingresar" },
  { id: "rastrear", path: "/rastrear" },
  { id: "fleteros", path: "/fleteros" },
  { id: "perfil-empresa", path: "/perfil", user: "empresa@truckpool.app" },
  { id: "perfil-fletero", path: "/perfil", user: "flete@truckpool.app" },
  { id: "solicitudes", path: "/solicitudes", user: "empresa@truckpool.app" },
  { id: "admin", path: "/admin", user: "admin@truckpool.app" },
  {
    id: "admin-verificaciones",
    path: "/admin/verificaciones",
    user: "admin@truckpool.app",
  },
  { id: "nosotros", path: "/nosotros" },
  { id: "no-encontrada", path: "/no-existe" },
].filter((s) => !only || only.split(",").includes(s.id));

const tokens = {};
async function token(email) {
  if (tokens[email]) return tokens[email];
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  tokens[email] = (await res.json()).token;
  return tokens[email];
}

const VIEWPORTS = [
  { name: "desktop", opts: { viewport: { width: 1440, height: 900 } } },
  {
    name: "mobile",
    opts: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
  },
];

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  for (const s of SCREENS) {
    const ctx = await browser.newContext({
      ...vp.opts,
      locale: "es-AR",
      timezoneId: "America/Argentina/Buenos_Aires",
      reducedMotion: "reduce",
    });
    if (s.user) {
      const t = await token(s.user);
      await ctx.addInitScript((tk) => localStorage.setItem("truckpool_token", tk), t);
    }
    const page = await ctx.newPage();
    if (s.mock) {
      await page.route(/\/api\/trips(\?.*)?$/, (route) =>
        route.request().method() === "GET"
          ? route.fulfill({ json: MOCK_TRIPS })
          : route.continue()
      );
    }
    await page.goto(base + s.path, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    // las barras fijas (header sticky, próxima acción) no se repiten en la captura larga
    await page.screenshot({
      path: `${out}/${s.id}-${vp.name}-pantalla.jpg`,
      type: "jpeg",
      quality: 82,
    });
    await page.addStyleTag({
      content:
        "header{position:relative!important} [data-fija]{position:static!important}",
    });
    // en JPEG: en PNG las 168 capturas de la comparación pesaban 41 MB
    await page.screenshot({
      path: `${out}/${s.id}-${vp.name}.jpg`,
      fullPage: true,
      // la larga a 1x: a 2x las de mobile solas pesaban 14 MB
      scale: "css",
      type: "jpeg",
      quality: 78,
    });
    await ctx.close();
    console.log("ok", vp.name, s.id);
  }
}
await browser.close();
