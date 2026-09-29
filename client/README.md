# TruckPool — Client

Frontend de TruckPool: React 19 + Vite 8 + Tailwind v4 + TanStack Query +
React Router 7. Los mapas son Leaflet (OpenStreetMap), cargados con `lazy()`
para que el bundle de la home no los arrastre.

Detalles del proyecto completo (server, setup de BD, pasos de uso) en el
[README de la raíz](../README.md).

## Scripts

- `npm run dev` — servidor de desarrollo (Vite elige el puerto libre)
- `npm run build` — `tsc -b` + build de producción
- `npm run preview` — previsualiza el build
- `npm run lint` — ESLint

No hay suite de tests automatizados en el client: la verificación es
`npm run typecheck` (`npx tsc --noEmit`), `npm run lint` y `npm run build`.

## API

La URL base se configura con `VITE_API_URL` (default `http://localhost:4000/api`).
El token de sesión se guarda en `localStorage` (`truckpool_token`) y se envía como
`Authorization: Bearer …` en cada request.

El origen de CORS tiene que permitir el puerto del dev server: en desarrollo el
server acepta cualquier `http://localhost:<puerto>`.

## Rutas

| Ruta                    | Pantalla                                  |
| ----------------------- | ----------------------------------------- |
| `/`                     | Landing                                  |
| `/ingresar`             | Login / registro                         |
| `/viajes`               | Viajes abiertos (con búsqueda por radio)  |
| `/viajes/nuevo`         | Publicar viaje (mapa con pines arrastrables) |
| `/viajes/:id`           | Detalle del viaje                        |
| `/viajes/:id/trackear`  | Tracking GPS (solo transportista)        |
| `/perfil`               | Perfil, viajes y cargas                  |
| `/fleteros` · `/fleteros/:id` | Transportistas                      |
| `/pagos/retorno`        | Retorno de Mercado Pago                  |
| `/admin` · `/admin/verificaciones` | Backoffice (solo ADMIN)         |

Cualquier otra ruta cae en la 404 de `pages/NotFound.tsx`.

## SEO

- `index.html` trae title, description, canonical y Open Graph.
- `public/og.png` es la imagen del preview al compartir un link
  (1200×630, generada a mano; si cambiás el isotipo, regenerala).
- `public/robots.txt` y `public/sitemap.xml` son estáticos: si cambia el
  dominio, hay que editarlos **y** `src/lib/seo.ts`, que es de donde salen los
  títulos por ruta (`DocumentTitle` los escribe en cada navegación porque la app
  es una SPA).
- `public/hero.webp` es la foto del hero (1920 px, 161 kB).
