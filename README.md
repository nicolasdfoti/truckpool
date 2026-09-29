# TruckPool

Marketplace logístico: los transportistas (`CARRIER`) publican viajes y las
empresas (`COMPANY`) suman carga al espacio que sobra en el camión.

## Estructura

```
client/   Frontend React 19 (Vite 8 + Tailwind v4 + TanStack Query + React Router 7)
server/   API Express 5 + Prisma 7 + PostgreSQL (ESM)
```

## Server

```bash
cd server
cp .env.example .env   # ajustar credenciales de la DB
npm install
docker compose up -d   # PostgreSQL (5433) + pgAdmin (http://localhost:5051)
npx prisma migrate dev # o npx prisma db push (primera corrida)
npm run db:seed        # usuarios demo + viajes de ejemplo
npm run dev            # http://localhost:4000
```

### Scripts

| Script                 | Qué hace                                        |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | server con recarga (`tsx watch`)                |
| `npm run build`        | compila a `dist/` (`npm start` lo corre)        |
| `npm test`             | suite de vitest (API + servicios)               |
| `npm run typecheck`    | `tsc --noEmit`                                  |
| `npm run lint`         | ESLint                                          |
| `npm run format`       | Prettier por encima de los fuentes              |
| `npm run db:seed`      | usuarios y viajes de ejemplo                    |
| `npm run seed:geocode` | rellena las coordenadas de viajes ya publicados |

### Usuarios demo (seed)

| Rol      | Email                 | Password       |
| -------- | --------------------- | -------------- |
| CARRIER  | flete@truckpool.app   | truckpool123   |
| COMPANY  | empresa@truckpool.app | truckpool123   |

### Endpoints

Públicos salvo que digamos lo contrario.

| Método | Ruta                                  | Auth               | Descripción                                  |
| ------ | ------------------------------------- | ------------------ | -------------------------------------------- |
| GET    | `/health`                             | —                  | Sonda de vida (también en `/api/health`)     |
| POST   | `/api/auth/register`                  | —                  | Crea cuenta (`COMPANY`/`CARRIER`), 10/15 min |
| POST   | `/api/auth/login`                     | —                  | Devuelve `{ token, user }`, 10/15 min        |
| GET    | `/api/auth/me`                        | Bearer             | Usuario de la sesión                         |
| GET    | `/api/trips`                          | —                  | Viajes abiertos (filtros + `nearOrigin`/`nearDestination`) |
| GET    | `/api/trips/:id`                      | —                  | Detalle con carga                            |
| POST   | `/api/trips`                          | `CARRIER` verificado | Publica un viaje (origen/destino/hora)     |
| GET    | `/api/trips/geocode?address=`         | —                  | Resuelve una dirección a coordenadas        |
| GET    | `/api/trips/:id/manifest.pdf`         | involved           | Remito en PDF                                |
| POST   | `/api/trips/:id/cargo-items`          | `COMPANY`          | Agrega carga (prorratea el precio)           |
| PATCH  | `/api/trips/:id/status`               | `CARRIER`          | Avanza el estado del viaje                   |
| PATCH  | `/api/trips/:tripId/cargo-items/:id`  | involved           | Cancela o confirma una carga                 |
| GET/POST | `/api/trips/:id/messages`           | involved           | Mensajes del viaje                           |
| POST   | `/api/trips/:id/reviews`              | involved           | Calificación                                |
| GET/POST | `/api/trips/:id/location`           | `CARRIER` (POST)   | Tracking GPS                                 |
| POST   | `/api/cargo-items/:id/payment-preference` | `COMPANY`      | Checkout de Mercado Pago                     |
| POST   | `/api/payments/webhook`               | firma MP           | Webhook de Mercado Pago                      |
| GET    | `/api/notifications`                  | Bearer             | Avisos del usuario                           |
| PATCH  | `/api/notifications/:id/read`         | Bearer             | Marca un aviso como leído                    |
| PATCH  | `/api/notifications/read-all`         | Bearer             | Marca todos como leídos                      |
| GET    | `/api/carriers`                       | —                  | Transportistas públicos                      |
| GET    | `/api/users/me` · `PATCH /api/users/me` | Bearer           | Perfil y datos de contacto                   |
| PATCH  | `/api/users/me/verification`          | Bearer             | Solicita verificación de identidad           |
| GET    | `/api/admin/verifications`            | `ADMIN`            | Verificaciones pendientes                    |
| PATCH  | `/api/admin/verifications/:userId`    | `ADMIN`            | Aprueba o rechaza                            |
| GET    | `/api/admin/stats`                    | `ADMIN`            | Métricas de la plataforma                    |

### Seguridad

- `helmet` con CSP `default-src 'none'`: la API no sirve HTML, así que no
  necesita cargar nada. HSTS y `upgrade-insecure-requests` solo en producción
  (en local romperían el server http de localhost).
- Rate limiting en login y registro: 10 intentos por IP cada 15 minutos
  (`AUTH_RATE_LIMIT_MAX` para cambiarlo). En el login solo cuentan los fallidos.
- `TRUST_PROXY` define de qué salto se lee la IP real detrás de un proxy.
- CORS: en desarrollo acepta cualquier `http://localhost:<puerto>`; en
  producción usa `CORS_ORIGIN` (lista separada por comas).

### Notas de diseño

- `price` y `priceShare` son `Decimal(12,2)`.
- `capacityUsed` nunca se guarda: se calcula sumando los `CargoItem.volume`.
- `addCargoItem` corre en una transacción `Serializable` con reintento ante
  deadlock (P2034).
- `departureTime` es `String?` con formato `HH:mm` (24 h) y se muestra pegado a
  la fecha del viaje; no se guarda como timestamp para no pelearse con la zona
  horaria del navegador.
- Origen y destino se geocodifican contra Nominatim encola de a uno (1 req/s,
  cache 24 h). Si el geocode falla, el viaje se publica igual pero sin
  coordenadas: no aparece en el mapa ni en las búsquedas por radio.
- La API nunca expone las coordenadas exactas en las respuestas públicas; se
  usan server-side para ordenar por distancia.

## Client

```bash
cd client
npm install
npm run dev -- --port 5173   # el puerto es el que quede libre
npm run build
```

| Script              | Qué hace                          |
| ------------------- | --------------------------------- |
| `npm run dev`       | servidor de Vite                  |
| `npm run build`     | build de producción a `dist/`    |
| `npm run preview`   | sirve el build                    |
| `npm run lint`      | ESLint                            |

La URL de la API se configura con `VITE_API_URL` (default
`http://localhost:4000/api`).

## Tests

```bash
cd server && npm test
```

El client no tiene suite automatizada: se verifica con `npm run typecheck`,
`npm run lint` y `npm run build`. Los estados de carga, la 404 y el error
boundary se pueden ver a mano en `npm run dev`.
