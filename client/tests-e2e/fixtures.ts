import { test as base, expect, type Page } from "@playwright/test";

/** la API de dev; el client la lee de VITE_API_URL con el mismo default */
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000/api";

/** misma clave que src/api/client.ts */
const TOKEN_KEY = "truckpool_token";

const PASSWORD = "truckpool123";

/**
 * Usuarios del e2e. flete@, empresa@ y admin@ son los del seed demo; los e2e-*
 * los crea `npm run db:seed:e2e` en server/ (lo corre global-setup.ts).
 */
export const USERS = {
  carrier: "flete@truckpool.app",
  company: "empresa@truckpool.app",
  admin: "admin@truckpool.app",
  /** segunda empresa con carga viva en el viaje de roles */
  secondCompany: "e2e-segunda@truckpool.app",
  /** retiró su única carga del viaje de roles (D9) */
  formerCompany: "e2e-ex@truckpool.app",
  /** empresa sin carga en el viaje de roles */
  otherCompany: "e2e-otra@truckpool.app",
} as const;

export type E2EUser = keyof typeof USERS;

/** lo que deja server/prisma/seed-e2e.ts: ids y textos fijos */
export const E2E = {
  rolesTripId: "e2e-trip-roles",
  reviewsTripId: "e2e-trip-reviews",
  /** IN_TRANSIT: empresa@ con carga viva y e2e-ex@ con la suya retirada */
  transitTripId: "e2e-trip-transit",
  departureAddress: "E2E Galpón Flete 100, Córdoba",
  cargo: {
    owner: {
      description: "E2E carga de la dueña",
      pickupAddress: "E2E Calle Dueña 111, Villa María",
      volume: 4,
    },
    second: {
      description: "E2E carga de la segunda",
      pickupAddress: "E2E Calle Segunda 222, Marcos Juárez",
      /** la localidad del retiro: lo único que ven las otras empresas (L6) */
      pickupCity: "Marcos Juárez",
      volume: 3,
    },
    former: {
      description: "E2E carga del ex participante",
      pickupAddress: "E2E Calle Ex 333, Bell Ville",
      volume: 2,
    },
  },
  transitCargo: {
    owner: { description: "E2E carga en tránsito de la dueña" },
    former: { description: "E2E carga en tránsito del ex participante" },
  },
  reviewComment: "E2E reseña: puntual y prolijo",
  /** L7: OPEN a 10 días, con tres cargas (ver seed-e2e.ts) */
  lifecycleTripId: "e2e-trip-lifecycle",
  lifecycleCargo: {
    /** empresa@, PENDING sin seña */
    unpaid: { description: "E2E ciclo sin seña", volume: 4, depositAmount: 80 },
    /** e2e-segunda@, PENDING con la seña aprobada */
    paidPending: { description: "E2E ciclo con seña", volume: 3, depositAmount: 60 },
    /** empresa@, CONFIRMED con la seña aprobada */
    confirmed: { description: "E2E ciclo confirmada", volume: 5, depositAmount: 100 },
  },
  /** L7: OPEN a 10 días, con una carga PENDING sin seña de e2e-otra@ */
  cancelTripId: "e2e-trip-cancel",
} as const;

/** el token de un usuario, por API: sin pasar por el formulario de login */
export async function apiToken(user: E2EUser): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: USERS[user], password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`no se pudo iniciar sesión como ${USERS[user]}: ${res.status}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** GET a la API con la sesión de un usuario (para leer lo que el e2e compara) */
export async function apiGet<T>(path: string, user: E2EUser): Promise<T> {
  const token = await apiToken(user);
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} como ${USERS[user]}: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Deja la página logueada como `user`: el token va a localStorage antes de que
 * cargue la app, igual que después de un login por el formulario.
 */
export async function loginAs(page: Page, user: E2EUser) {
  const token = await apiToken(user);
  // como texto: este archivo compila sin los tipos del DOM
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)});`,
  });
}

export const test = base;
export { expect };
