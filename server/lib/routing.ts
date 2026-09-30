/**
 * Routing via OSRM (Open Source Routing Machine) demo server.
 *
 * IMPORTANTE: esto usa el demo público de OSRM (router.project-osrm.org).
 * No tiene SLA, no hay garantía de disponibilidad ni de rendimiento en producción.
 * Si el proyecto crece, la alternativa es self-hostear OSRM (también gratis,
 * pero requiere infra propia: un servidor con ~10-20 GB RAM para Argentina,
 * o el planet entero con más recursos).
 *
 * La llamada tiene un timeout de ~5s: si falla o tarda más, devolvemos null
 * y el frontend dibuja líneas rectas como fallback silencioso (la app sigue
 * siendo útil sin ruta exacta).
 */

export type LatLng = { lat: number; lng: number };

const OSRM_BASE_URL = "https://router.project-osrm.org/route/v1/driving";
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Obtiene la geometría de la ruta real (siguiendo calles) pasando por todos
 * los puntos en orden.
 *
 * @param points Array de {lat, lng} en orden: partida, paradas intermedias, destino
 * @returns Array de coordenadas [lng, lat] de la ruta (formato GeoJSON LineString),
 *          o null si falla/timeout.
 */
export async function fetchRouteGeometry(
  points: LatLng[]
): Promise<[number, number][] | null> {
  if (points.length < 2) return null;

  // OSRM espera coordenadas en formato "lng,lat;lng,lat;..."
  const coordinates = points.map((p) => `${p.lng},${p.lat}`).join(";");

  const url = new URL(`${OSRM_BASE_URL}/${coordinates}`);
  // OJO: el parámetro es "geometries" (con s). Con "geometry" OSRM responde 400
  // InvalidQuery y caemos al fallback recto, sin avisar.
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "false");
  url.searchParams.set("annotations", "false");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "truckpool/1.0 (MVP; contacto@truckpool.app)",
      },
    });

    if (!res.ok) {
      console.warn(`[routing] OSRM responded ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      code: string;
      routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
    };

    if (data.code !== "Ok") {
      console.warn(`[routing] OSRM code: ${data.code}`);
      return null;
    }

    const route = data.routes?.[0];
    const geometryCoordinates = route?.geometry?.coordinates;
    if (!Array.isArray(geometryCoordinates) || geometryCoordinates.length < 2) return null;

    // GeoJSON coordinates son [lng, lat]
    return geometryCoordinates;
  } catch (err) {
    // timeout, DNS, red, JSON inválido: devolvemos null silenciosamente
    console.warn(
      "[routing] fetchRouteGeometry failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
