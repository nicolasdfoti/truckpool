import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SITE_TITLE, TITLE_BY_PATH } from "../lib/seo";

/**
 * Es una SPA: el <title> del index.html queda fijo para todas las rutas, así
 * que copiar un link a /viajes en WhatsApp manda el título de la home. Acá se
 * reescribe en cada navegación.
 */
export function DocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    // las rutas con : (ej. /viajes/:id) matchean por prefijo; la más larga gana
    const key = Object.keys(TITLE_BY_PATH)
      .filter((path) => path !== "/" && pathname.startsWith(path))
      .sort((a, b) => b.length - a.length)[0];

    document.title = key ? TITLE_BY_PATH[key] : (TITLE_BY_PATH[pathname] ?? SITE_TITLE);
  }, [pathname]);

  return null;
}
