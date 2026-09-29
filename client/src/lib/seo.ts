/**
 * Datos de SEO del sitio en un solo lugar: los usa el <title> por ruta
 * (main.tsx) y los archivos robots.txt / sitemap.xml de public/.
 *
 * El dominio está hardcodeado a propósito: son archivos estáticos que se
 * sirven sin build, así que no pueden leer VITE_*. Cuando haya dominio real
 * hay que cambiar estas dos constantes y los tres archivos de public/.
 */
export const SITE_ORIGIN = "https://truckpool.app";
export const SITE_TITLE = "TruckPool — compartí el flete, viajá más barato";

/** Título por ruta. Las claves con :matchean por prefijo (ver main.tsx). */
export const TITLE_BY_PATH: Record<string, string> = {
  "/": SITE_TITLE,
  "/ingresar": "Ingresá — TruckPool",
  "/viajes": "Viajes abiertos — TruckPool",
  "/viajes/nuevo": "Publicar un viaje — TruckPool",
  "/viajes/:id": "Detalle del viaje — TruckPool",
  "/viajes/:id/trackear": "Tracking del viaje — TruckPool",
  "/rastrear": "Rastrear un envío — TruckPool",
  "/solicitudes": "Mis solicitudes — TruckPool",
  "/nosotros": "Sobre TruckPool — TruckPool",
  "/perfil": "Mi perfil — TruckPool",
  "/fleteros": "Transportistas — TruckPool",
  "/fleteros/:id": "Perfil del transportista — TruckPool",
  "/pagos/retorno": "Pago — TruckPool",
  "/admin": "Dashboard — TruckPool",
  "/admin/verificaciones": "Verificaciones — TruckPool",
};

/** Rutas públicas que tiene sentido indexar (las demás necesitan sesión). */
export const INDEXABLE_PATHS = ["/", "/viajes", "/fleteros", "/ingresar"];
