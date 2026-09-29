/**
 * Geocoding contra Nominatim (OpenStreetMap).
 *
 * Cosas que este módulo tiene que respetar sí o sí:
 *
 * 1. Rate limit de Nominatim: máximo 1 request por segundo. Todas las llamadas
 *    pasan por una cola serial con 1s de separación entre requests.
 * 2. User-Agent obligatorio y único: Nominatim bloquea requests sin uno, y
 *    también los que son genéricos ("curl"). Configurable por env.
 * 3. La red puede no estar. Un geocode que falla devuelve `null` y nunca
 *    rompe la operación de negocio: publicar un viaje no puede fallar porque
 *    Nominatim esté caído.
 */

const DEFAULT_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_USER_AGENT = "truckpool/1.0 (MVP-stage-9; contacto@truckpool.app)";
const REQUEST_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // un día: son lugares, no precios
const MAX_CACHE_ENTRIES = 500;

export type LatLng = { lat: number; lng: number };

type CacheEntry = { value: LatLng | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function baseUrl(): string {
  return process.env.NOMINATIM_URL ?? DEFAULT_URL;
}

function userAgent(): string {
  return process.env.NOMINATIM_USER_AGENT ?? DEFAULT_USER_AGENT;
}

function readCache(address: string): { hit: boolean; value: LatLng | null } {
  const entry = cache.get(address);
  if (!entry) return { hit: false, value: null };
  if (entry.expiresAt < Date.now()) {
    cache.delete(address);
    return { hit: false, value: null };
  }
  return { hit: true, value: entry.value };
}

function writeCache(address: string, value: LatLng | null) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // descarte lo más viejo: Map preserva el orden de inserción
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(address, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function clearGeocodeCache() {
  cache.clear();
}

export function geocodeCacheSize() {
  return cache.size;
}

// --- cola de rate limit ----------------------------------------------------
// una sola promesa encadenada: cada request espera a que termine la anterior
// más 1s de diferencia.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const MIN_GAP_MS = 1000;

async function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return task();
  });
  // la cola no se rompe si una tarea falla
  queue = run.catch(() => undefined);
  return run;
}

async function fetchLatLng(address: string): Promise<LatLng | null> {
  const url = new URL(baseUrl());
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent(),
        Accept: "application/json",
        "Accept-Language": "es",
      },
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0] as { lat?: unknown; lon?: unknown };
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  } catch {
    // timeout, DNS, 429, JSON inválido: para nosotros es "no pudimos resolver"
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convierte "Rosario, Santa Fe" en lat/lng. Cacheado por string exacto de
 * entrada, así que dos llamadas con el mismo texto no gastan el rate limit.
 * Devuelve `null` si no se pudo resolver — nunca throw.
 */
export async function geocode(address: string): Promise<LatLng | null> {
  const key = address.trim();
  if (!key) return null;

  const cached = readCache(key);
  if (cached.hit) return cached.value;

  const value = await enqueue(() => fetchLatLng(key));
  writeCache(key, value);
  return value;
}

const EARTH_RADIUS_KM = 6371;

/** distancia en km entre dos puntos, con la fórmula de haversine */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
