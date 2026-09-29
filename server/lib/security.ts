import helmet from "helmet";
import type { RequestHandler } from "express";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Headers de seguridad de la API.
 *
 * La API no sirve HTML ni ejecuta scripts: devuelve JSON y un PDF. Eso permite
 * una CSP mucho más restrictiva que la de un sitio ("no cargues nada"), que es
 * justo lo que protege si algún día alguien logra que una respuesta de la API
 * se interprete como documento.
 *
 * Lo que NO puede romper:
 * - CORS: lo maneja el middleware de cors, que corre después y pisa headers.
 * - El manifiesto PDF: se pide con fetch() desde otro origen (client en
 *   5173, API en 4000), así que la respuesta tiene que quedar legible para un
 *   origen distinto → crossOriginResourcePolicy "cross-origin".
 * - Google Fonts y los tiles de OpenStreetMap: los carga el navegador contra
 *   la página del cliente (Vite), no contra la API, así que acá no van.
 *   La CSP de la app web se define en el Hosting, no acá.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      // sin los defaults de helmet: la lista de arriba es la lista completa.
      // Con `default-src 'none'` alcanza para una API que devuelve JSON.
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        // en producción un http:// cualquiera tiene que terminar en https://;
        // en local rompería el dev server http://localhost.
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    // HSTS en local poison-ea localhost: el navegador.passaría a exigir https
    // contra el dev server, que no lo tiene.
    strictTransportSecurity: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    // el PDF del manifiesto se descarga con fetch cross-origin: si queda en
    // same-origin el navegador lo bloquea al armar el blob.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "no-referrer" },
    frameguard: { action: "deny" },
  });
}

/**
 * `trust proxy` define de qué salto se cree el header X-Forwarded-For, que es
 * de donde sale la IP que ve el rate limiter. Sin esto, detrás de un proxy
 * todas las requests parecen venir del proxy y el límite se comparte entre
 * todos los usuarios; con `true` a secas, cualquiera podría mandar su propio
 * X-Forwarded-For y esquivarlo. El número de saltos es lo correcto.
 */
export function applyTrustProxy(app: {
  set: (key: string, value: unknown) => void;
}): void {
  const configured = process.env.TRUST_PROXY;
  if (configured) {
    const hops = Number(configured);
    app.set(
      "trust proxy",
      Number.isFinite(hops) && hops > 0 ? hops : configured === "true" ? 1 : false
    );
    return;
  }
  // en producción lo normal es un reverse proxy delante (Railway, Fly, nginx);
  // en local no hay ninguno y hay que poner la IP real tal cual.
  app.set("trust proxy", isProduction ? 1 : false);
}
