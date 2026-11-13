import { useLocation } from "react-router-dom";
import { loginHref } from "../lib/returnTo";

/** RD8: links a /ingresar que vuelven a la página actual (ruta y query) */
export function useLoginHref() {
  const location = useLocation();
  const here = location.pathname + location.search;
  return (params: Record<string, string> = {}) => loginHref(here, params);
}
