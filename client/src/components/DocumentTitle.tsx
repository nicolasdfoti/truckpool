import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { titleFor } from "../lib/seo";

/**
 * Es una SPA: el <title> del index.html queda fijo para todas las rutas, así
 * que copiar un link a /viajes en WhatsApp manda el título de la home. Acá se
 * reescribe en cada navegación.
 */
export function DocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = titleFor(pathname);
  }, [pathname]);

  return null;
}
