<div align="center">

# TruckPool

**Marketplace de transporte de carga compartida.**

Los transportistas publican los viajes que ya van a hacer igual, ocupando el
espacio que sobra en el camión. Las empresas les compran ese espacio:
cargan su mercadería, pagan una seña por reservar y el resto con el viaje en
camino. Sin camiones vacíos, sin fletes urgentes pagados al doble, sin gastar
combustible en kilos de aire.

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Node](https://img.shields.io/badge/Node-20.19%2B-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Mercado Pago](https://img.shields.io/badge/Mercado%20Pago-integrado-00B2E3?style=flat-square)](https://www.mercadopago.com.ar/)

</div>

---

## Tabla de contenidos

- [Qué resuelve](#qué-resuelve)
- [Los tres roles](#los-tres-roles)
- [Cómo funciona un viaje de punta a punta](#cómo-funciona-un-viaje-de-punta-a-punta)
- [Funcionalidades](#funcionalidades)
- [Stack técnico](#stack-técnico)
- [Arquitectura](#arquitectura)
- [Modelo de datos](#modelo-de-datos)
- [API](#api)
- [Pasos para levantarlo](#pasos-para-levantarlo)
- [Variables de entorno](#variables-de-entorno)
- [Scripts](#scripts)
- [Mantenimiento](#mantenimiento)
- [Despliegue](#despliegue)
- [Decisiones de diseño](#decisiones-de-diseño)
- [Seguridad](#seguridad)
- [Tests](#tests)
- [Estructura del repositorio](#estructura-del-repositorio)

---

## Qué resuelve

El flete de larga distancia tiene un problema clásico: **el camión vuelve con
espacio vacío y nadie lo aprovecha**. El operador paga el viaje entero, la
mercadería de otros ocupa lugar sin costo, y todos pierden.

Al revés también: una empresa chica necesita mover una paleta a otra provincia
y tiene que pagar un flete completo por 200 kg.

TruckPool empareja los dos lados:

| Transportista (`CARRIER`) | Empresa (`COMPANY`) |
| --- | --- |
| Ya tiene un viaje que va a hacer | Tiene carga y no tiene transporte |
| Publica origen, destino, fecha, tipo de camión y m³ libres | Compra ese espacio por `priceShare` |
| Cobra el `priceShare` de cada carga que confirma | Paga la seña al reservar y el saldo con el viaje en camino |
| Confirma las cargas, ordena las paradas y reparte | Sigue su carga por código de tracking |

El resultado: el transportista no cambia su ruta y factura un flete que ya
estaba haciendo; la empresa evita el flete completo.

---

## Los tres roles

| Rol | Qué hace | Cómo se entra |
| --- | --- | --- |
| **`COMPANY`** | Reserva espacio en viajes abiertos, paga seña y saldo, pide viajes a un transportista, sigue el tracking, califica al transportista | `POST /api/auth/register` |
| **`CARRIER`** | Publica viajes, confirma cargas, sube GPS, ordena paradas, genera el manifiesto, cobra. No califica viajes | `POST /api/auth/register` |
| **`ADMIN`** | Aprueba o rechaza verificaciones de identidad, ve métricas de la plataforma | En producción, `npm run admin:create`. En desarrollo, el seed demo |

Para publicar, el transportista necesita dos cosas: la verificación de
identidad aprobada (`UNVERIFIED → PENDING → VERIFIED | REJECTED`, con DNI o
CUIT, que el admin revisa desde `/admin/verificaciones`) y su cuenta de Mercado
Pago conectada por OAuth, porque los cobros entran ahí. No existe endpoint HTTP
para crear ni promover a `ADMIN`.

---

## Cómo funciona un viaje de punta a punta

```
1.  CARRIER publica un viaje
    origen → destino, fecha, tipo de camión, m³, precio total, % de seña
    ↓
2.  El sistema geocodifica origen, destino y punto de salida
    (Nominatim, solo Argentina, caché 24 h). Si falla, el viaje se publica igual
    ↓
3.  COMPANY encuentra el viaje y reserva espacio (estado PENDING)
    la API prorratea el precio por m³ → priceShare
    se congela la seña (depositPercent, default 20 %)
    ↓
4.  COMPANY paga la seña con Mercado Pago
    el pago entra en la cuenta del CARRIER y la plataforma retiene su comisión
    una reserva sin seña vence a las 24 h y libera el espacio
    ↓
5.  CARRIER confirma la carga (solo con la seña acreditada)
    PENDING → CONFIRMED
    ↓
6.  CARRIER ordena las paradas de retiro y sale (OPEN | FULL → IN_TRANSIT)
    las cargas que siguen PENDING se cancelan, con la seña devuelta entera
    ↓
7.  En viaje: GPS en vivo, chat, tracking público por código
    COMPANY paga el saldo
    ↓
8.  CARRIER cierra el viaje (IN_TRANSIT → COMPLETED)
    COMPANY califica al transportista
```

Si el transportista no sale, puede cancelar el viaje desde `OPEN` o `FULL`, y
un job lo cancela solo 24 h después de la salida prevista: en los dos casos las
cargas activas se cancelan con la seña cobrada devuelta entera.

También existe el flujo inverso: si la empresa no encuentra un viaje que le
sirva, manda una **solicitud de viaje** (`TripRequest`) a un transportista, que
puede aceptarla y termina creando un viaje.

---

## Funcionalidades

### Marketplace de carga

- Publicación de viajes con tipo de camión, capacidad en m³, precio, features
  (`refrigeracion`, `seguro`, `carga_fragil`, `expreso`, `carga_y_descarga`)
  y múltiples ventanas de carga/recogida.
- Búsqueda por origen, destino, fecha, radio en km (`nearOrigin` /
  `nearDestination`), features y disponibilidad.
- **Precio sugerido en vivo** al publicar (`GET /api/trips/price-estimate`): es
  una referencia, el fletero pone el precio que quiera (ver Decisiones de
  diseño). Antes de reservar, la empresa ve cuánto le cuesta su volumen
  (`GET /api/trips/:id/cargo-quote`).
- **Cotización del retiro** de una carga
  (`GET /api/trips/:tripId/cargo-items/:cargoItemId/cancellation-quote`): la
  penalización real según cuán cerca está la salida y lo que la empresa ya
  pagó ($ 0 si la seña no se pagó). El cliente no la recalcula: la pide.
- Solicitudes de viaje inversas (`TripRequest`) cuando la empresa no encuentra
  capacidad y prefiere que sea el transportista el que publique.
- Reseñas de una sola dirección: califica **solo la empresa** (quien mandó la
  carga), una vez por viaje `COMPLETED`, y siempre al fletero de ese viaje. El
  fletero no califica, y el rating se muestra en su perfil público.

### Pagos con Mercado Pago

- Checkout con **Mercado Pago Checkout Pro** para la seña (`DEPOSIT`) y el saldo
  (`BALANCE`, con la carga confirmada y el viaje en camino).
- El pago se crea **en la cuenta del transportista** (Marketplace / OAuth), no en
  una cuenta de la plataforma: la plata va al que transporta.
- Comisión de plataforma (`platformFeePercent`, default 10 %) retenida sobre cada
  pago.
- **Reembolsos** por un outbox (`RefundRequest`) que un job reintenta con
  backoff, con estado `REFUNDED` en la base. La comisión se recalcula sobre lo
  efectivamente cobrado.
- **Webhooks** firmados con HMAC-SHA256 y comparación en tiempo constante
  (`timingSafeEqual`): sin la firma correcta, la petición se rechaza. Un job
  concilia con MP los pagos pendientes por si se pierde un webhook, y los
  contracargos quedan en `CHARGED_BACK` con aviso a los admins.
- Tokens de transportista guardados **cifrados** en la base con AES-256-GCM
  (`TOKEN_ENCRYPTION_KEY`), nunca devueltos por la API.
- Errores sanitizados: los errores de Mercado Pago se traducen a códigos
  internos (`MP_ERROR`, `MP_INVALID_RESPONSE`, `MP_NOT_CONFIGURED`) sin filtrar
  el request crudo, que puede contener headers con el token.

### Operación del viaje

- **Tracking GPS en vivo** con Leaflet, línea de tiempo del recorrido y
  actualización de la posición cada vez que el transportista reporta.
- **Hoja de ruta**: reordenamiento manual de paradas con drag & drop
  (`@dnd-kit`), con orden automático por proyección sobre la línea
  origen-destino cuando el transportista no lo customiza. Si las reordena con
  el viaje en camino, se avisa a las empresas cuya parada cambió de lugar.
- **Manifiesto PDF** generado con PDFKit, descargable por el fletero y por las
  empresas con carga activa en el viaje.
- **Chat por viaje** con hilo de mensajes y marca de leídos.
- **Tracking público** por código (`TP-XXXX-XXXX-XXXX-XXXX`, 80 bits
  aleatorios) para el receptor final de la mercadería, sin necesidad de cuenta:
  origen, destino, fecha y estado.

### Plataforma

- Notificaciones in-app por tipo (`MESSAGE`, `CARGO_ADDED`, `CARGO_CONFIRMED`,
  `CARGO_CANCELLED`, `TRIP_STATUS_CHANGED`, `PAYMENT_APPROVED`, `BALANCE_DUE`,
  `TRIP_REQUEST`, `TRIP_REQUEST_RESPONSE`, `PAYMENT_ALERT`, `STOPS_REORDERED`),
  con campana y contador de no leídas.
- Emails transaccionales vía **Resend** (opt-out por usuario), con templates
  para cada evento del ciclo de vida del viaje.
- Panel de admin: verificaciones pendientes y métricas de la plataforma
  (viajes por estado, volumen confirmado, facturado, rating promedio, conteo de
  transportistas y empresas).
- Tareas periódicas en el mismo proceso de la API (`lib/jobs.ts`): reembolsos
  pendientes, reservas vencidas, viajes que no salieron y conciliación de pagos.
- SEO por ruta: título y description dinámicos en cada página.
- `AppErrorBoundary` y páginas `404` propias.

---

## Stack técnico

**Frontend**: React 19 · Vite 8 · TypeScript 6 · Tailwind CSS 4 ·
TanStack Query 5 · React Router 7 · Leaflet + react-leaflet · @dnd-kit ·
Playwright

**Backend**: Node 20.19+ · Express 5 · TypeScript 6 (ESM) · Prisma 7 ·
PostgreSQL 16 · Zod 4 · jsonwebtoken · bcryptjs · helmet · cors ·
express-rate-limit · mercadopago · pdfkit · @turf/turf · dotenv

**Testing**: Vitest 4 + supertest (backend) · Playwright (e2e del frontend)

**Tooling**: ESLint 10 (flat config) · Prettier 3 · tsx · Docker Compose ·
GitHub Actions

### Por qué estas elecciones

- **Express 5 + ESM**: el sistema de errores async es nativo (un `throw` en un
  handler llega al error middleware sin `next(err)`). El código usa
  `"type": "module"` con imports relativos explícitos `.js`, también desde los
  `.ts`.
- **Prisma 7 con `@prisma/adapter-pg`**: el adapter usa el driver `pg` y su
  pool en vez del engine binario nativo.
- **Zod como única fuente de validación**: los schemas viven junto al módulo
  (`*.schemas.ts`) y un middleware genérico (`validateBody` / `validateQuery`)
  los aplica a las rutas. No hay validación repetida en los controllers.
- **TanStack Query**: el backend es la fuente de verdad; los hooks manejan
  caché, invalidación por mutación y reintentos sin boilerplate.
- **Tailwind v4 con `@tailwindcss/vite`**: sin `tailwind.config.js`, el tema va
  por CSS (`client/src/index.css`).

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────┐
│  client/  React 19 (SPA)                                 │
│  pages/ · components/ · hooks/ · api/ · lib/ · types/    │
└───────────────────────┬──────────────────────────────────┘
                        │  fetch  ·  Bearer JWT
                        │  VITE_API_URL
┌───────────────────────▼──────────────────────────────────┐
│  server/  Express 5                                      │
│                                                          │
│  src/app.ts        pipeline: helmet → json → cors →      │
│                    routes → 404 → errorHandler           │
│  src/index.ts      bootstrap: .env, validación del       │
│                    entorno, listen y jobs                │
│  modules/          auth · trips · users · payments ·     │
│                    notifications (routes/controller/     │
│                    service/schemas por módulo)           │
│  lib/              env · auth · validate · mappers ·     │
│                    errors · crypto · mercadopago ·       │
│                    geocode · routing · pricing ·         │
│                    cancellation · reservations · jobs ·  │
│                    email · notifications · manifestPdf · │
│                    rateLimit · security …                │
└───────────────────────┬──────────────────────────────────┘
                        │  Prisma Client (@prisma/adapter-pg)
┌───────────────────────▼──────────────────────────────────┐
│  PostgreSQL 16  ·  server/schema.prisma                  │
│  migraciones en server/prisma/migrations                 │
└──────────────────────────────────────────────────────────┘

  Servicios externos (solo desde el server)
  ├─ Mercado Pago API    preferencias, pagos, reembolsos, OAuth
  ├─ Nominatim           geocodificación (solo Argentina, caché 24 h, 1 req/s)
  ├─ OSRM (demo público) geometría de la ruta por calles
  └─ Resend              emails transaccionales
```

`lib/`, `modules/` y `prisma/` viven en la raíz de `server/`, no adentro de
`src/`: `src/` solo tiene `app.ts` e `index.ts`.

**Flujo de una request:** `middleware → validate (Zod) → requireAuth /
requireRole → controller → service (ownership + lógica) → Prisma → mapper →
response`. Los controllers no hablan con Prisma; los services no tocan `req`/
`res`. Los errores son subclases de `AppError` (`lib/errors.ts`) y la API
responde `{ error, code }`; el cliente decide con el `code`.

**Archivos por módulo**, en `server/modules/<módulo>/`:

```
<módulo>.routes.ts       rutas + cadena de guards
<módulo>.controller.ts   req/res, llama al service
<módulo>.service.ts      lógica de negocio y ownership
<módulo>.schemas.ts      schemas Zod
```

`payments/` suma `refunds.service.ts`, `reconcile.service.ts` y
`alerts.service.ts`. `users.routes.ts` exporta también los routers de
`/api/carriers` y `/api/admin`, y el tracking público
(`/api/tracking/:trackingCode`) se monta directo en `src/app.ts`.

---

## Modelo de datos

12 modelos y 10 enums, en `server/schema.prisma`. Los centrales:

```
Trip (publicado por un CARRIER)
 ├─ CargoItem[]           cargas de COMPANY sobre ese viaje
 │   ├─ Payment[]         DEPOSIT (seña) y BALANCE (saldo)
 │   │   └─ RefundRequest[]  outbox de reembolsos
 │   └─ trackingCode      código público único
 ├─ Message[]             chat del viaje
 ├─ TripLocation[]        puntos GPS
 └─ Review[]              calificación empresa → fletero

User (COMPANY | CARRIER | ADMIN)
 ├─ cargoItems[]          como empresa
 ├─ trips[]               como transportista
 ├─ tripRequestsSent / Received
 └─ mpAccessToken         cifrado, nunca expuesto
```

Además: `Notification`, `TripRequest`, `RevokedToken` (logout) y
`PaymentAlert` (deduplica los avisos de pagos que no se pudieron asentar).

**Ciclo de vida de un viaje:**
`OPEN → FULL → IN_TRANSIT → COMPLETED`, o `CANCELLED` desde `OPEN` o `FULL`.

**Ciclo de vida de una carga:**
`PENDING → CONFIRMED`, o `CANCELLED` con su motivo (`cancellationReason`): la
retiró la empresa, se canceló el viaje, el viaje salió sin confirmarla, venció
la reserva o el fletero devolvió la seña.

**Estados de pago:** `PENDING → APPROVED | REJECTED → REFUNDED`, y
`APPROVED → CHARGED_BACK` (final).

**Decisiones de schema que vale la pena conocer:**

- `price`, `priceShare` y los montos de pago son `Decimal(12,2)`, nunca
  `Float`: son plata.
- **`capacityUsed` no existe como columna.** Se calcula sumando el `volume` de
  las cargas activas en el momento. Un valor desnormalizado se desincroniza
  apenas alguien cancela; una suma nunca miente.
- `depositAmount` se **congela** al crear la carga. Si el transportista después
  cambia `depositPercent` del viaje, las reservas ya hechas siguen valiendo lo
  que valían.
- `departureTime` es `String?` con formato `HH:mm` y se muestra pegado a la
  fecha del viaje. No se guarda como `timestamp` para no pelearse con la zona
  horaria del navegador.
- Las coordenadas (`originLat`, `originLng`…) son **opcionales a propósito**.
  Un viaje cuyo geocode falló se publica igual, pero no aparece en el mapa ni
  matchea búsquedas por radio.
- `departureAddress` es distinto de `origin`: `origin` es la ciudad/zona
  ("Córdoba"), `departureAddress` el punto exacto de salida
  ("Av. Colón 1234, Córdoba").
- Índices compuestos en `(status, date)`, `(status, originLat)` y
  `(status, destLat)` para que el filtro por proximidad no degenere en
  table scan.

---

## API

Todas bajo `/api` (`API_PREFIX`), salvo `/health`. `Bearer` = JWT obligatorio.
`role:X` = además requiere ese rol. `participante` = el fletero del viaje o una
empresa con carga activa; lo chequea el service.

### Salud

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| GET | `/health` y `/api/health` | — | `{ status: "ok", uptimeSeconds }`, sin tocar la base |

### Auth: `/api/auth`

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| POST | `/register` | — | Crea `COMPANY` o `CARRIER`, rate-limited |
| POST | `/login` | — | `{ token, user }`, rate-limited por IP y por email |
| GET | `/me` | Bearer | Usuario de la sesión |
| POST | `/logout` | Bearer | Revoca el `jti` del token |

### Viajes: `/api/trips`

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| GET | `/` | — | Viajes abiertos, con filtros y radio |
| GET | `/geocode?address=` | — | Dirección → coordenadas y lugar en texto (solo Argentina) |
| GET | `/price-estimate` | — | Precio sugerido y rango ±15 %, como referencia |
| GET | `/cancellation-quote` | — | Penalización según la fecha. Sin uso en el client; se retira en L11 |
| GET | `/:id/cargo-quote` | — | Precio y seña de un volumen antes de reservar |
| GET | `/:id` | sesión opcional | Detalle; cada rol ve lo suyo |
| POST | `/` | role:CARRIER | Publica viaje (verificado y con MP conectado) |
| PATCH | `/:id/status` | role:CARRIER | Sale, cierra o cancela el viaje |
| POST | `/:id/cargo-items` | role:COMPANY | Reserva espacio |
| GET | `/:tripId/cargo-items/:cargoItemId/cancellation-quote` | role:COMPANY | Cuánto cuesta retirar esa carga |
| DELETE | `/:tripId/cargo-items/:cargoItemId` | role:COMPANY | Retira la carga |
| PATCH | `/:tripId/cargo-items/:cargoItemId` | Bearer (fletero del viaje) | Confirma la carga; exige la seña acreditada |
| GET | `/:id/manifest.pdf` | participante | Manifiesto en PDF |
| GET | `/:id/route` | participante | Paradas que ve cada rol |
| GET | `/:id/route-geometry` | participante | Línea de la ruta (OSRM) |
| GET | `/:id/location` | participante | Tracking GPS |
| POST | `/:id/location` | role:CARRIER | Reporta posición |
| GET | `/:id/stops` | participante | Paradas ordenadas |
| PATCH | `/:id/stops/reorder` | role:CARRIER | Reordena paradas |
| GET | `/:id/messages` | participante | Chat del viaje |
| POST | `/:id/messages` | participante | Envía mensaje |
| PATCH | `/:id/messages/read` | participante | Marca leídos |
| POST | `/:id/reviews` | role:COMPANY + carga en el viaje | Califica al fletero (1 vez, viaje `COMPLETED`) |
| GET | `/tracking/:trackingCode` | — | Igual que `/api/tracking/:trackingCode` |

### Tracking

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| GET | `/api/tracking/:trackingCode` | — | Seguimiento público |

### Pagos (montados en la raíz de `/api`)

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| POST | `/api/cargo-items/:id/payment-preference` | role:COMPANY | Checkout MP de la seña o el saldo |
| POST | `/api/payments/webhook` | firma MP | Notificaciones MP |
| GET | `/api/payments/mp/test` | role:ADMIN | Diagnóstico MP (no existe en producción) |
| POST | `/api/payments/mp/test-preference` | role:ADMIN | Preferencia de prueba (no existe en producción) |
| GET | `/api/payments/mp/:id` | Bearer (dueño o ADMIN) | Traza de un pago (no existe en producción) |

### Usuarios: `/api/users`

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| GET/PATCH | `/me` | Bearer | Perfil |
| GET | `/me/trips` | role:CARRIER | Viajes como transportista |
| GET | `/me/cargo-items` | role:COMPANY | Cargas como empresa |
| PATCH | `/me/availability` | role:CARRIER | "Disponible ahora" |
| PATCH | `/me/verification` | role:CARRIER | Solicita verificación (DNI o CUIT) |
| GET | `/me/mp-connect` | role:CARRIER | URL de OAuth MP |
| GET | `/me/mp-callback` | — | Callback OAuth (state firmado) |
| POST | `/trip-requests` | role:COMPANY | Pide un viaje |
| GET | `/trip-requests/received` | role:CARRIER | Solicitudes recibidas |
| GET | `/trip-requests/sent` | role:COMPANY | Solicitudes enviadas |
| PATCH | `/trip-requests/:id/respond` | role:CARRIER | Acepta / rechaza |

### Transportistas, notificaciones y admin

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| GET | `/api/carriers` | — | Listado público |
| GET | `/api/carriers/:id` | sesión opcional | Perfil público |
| GET | `/api/notifications` | Bearer | Bandeja del usuario |
| PATCH | `/api/notifications/:id/read` | Bearer | Marca una como leída |
| PATCH | `/api/notifications/read-all` | Bearer | Marca todas |
| GET | `/api/admin/stats` | role:ADMIN | Métricas |
| GET | `/api/admin/verifications` | role:ADMIN | Pendientes |
| PATCH | `/api/admin/verifications/:userId` | role:ADMIN | Aprueba / rechaza |

---

## Pasos para levantarlo

**Requisitos:** Node 20.19+ (o 22.12+; el CI usa 24) y Docker, para el
PostgreSQL. La app no corre en Docker: solo la base.

```bash
# 1. Base de datos (desde la raíz del repo)
docker compose up -d postgres
#    PostgreSQL en :5433 (usuario postgres, password truckpool, base truckpool)
#    pgAdmin es opcional: necesita PGADMIN_EMAIL y PGADMIN_PASSWORD en un .env
#    de la raíz, y se levanta con `docker compose up -d` (http://localhost:5051)

# 2. Backend
cd server
cp .env.example .env
#    en .env: JWT_SECRET nuevo (openssl rand -hex 32) y JOBS_ENABLED=false
npm install
npx prisma generate       # genera el cliente de Prisma
npx prisma migrate dev    # aplica las migraciones
npm run db:seed           # usuarios y viajes demo (solo desarrollo)
npm run dev               # http://localhost:4000 (health: /api/health)

# 3. Frontend (otra terminal)
cd client
npm install
npm run dev               # http://localhost:5173
```

El `.env` mínimo para desarrollo es `DATABASE_URL`, `JWT_SECRET` y
`NODE_ENV=development`; el resto tiene default o solo hace falta para una parte
(pagos, emails). **`JOBS_ENABLED=false` en local**: los jobs devuelven señas y
concilian pagos contra Mercado Pago, y con un fletero conectado a una cuenta
real lo harían con plata de verdad. El log de arranque dice si quedaron
prendidos o apagados.

Probar pagos de punta a punta necesita un túnel HTTPS público a la API (ver
[Despliegue](#despliegue)): Mercado Pago no llega a `localhost`.

### Usuarios demo (solo desarrollo)

Los crea `npm run db:seed`. La contraseña es pública, así que el seed no corre
con `NODE_ENV=production`: en producción el admin se crea con
`npm run admin:create` (ver [Despliegue](#despliegue)).

| Rol | Email | Password |
| --- | --- | --- |
| `CARRIER` | `flete@truckpool.app` | `truckpool123` |
| `COMPANY` | `empresa@truckpool.app` | `truckpool123` |
| `ADMIN` | `admin@truckpool.app` | `truckpool123` |

El fletero demo ya está verificado. Para publicar viajes le falta conectar una
cuenta de Mercado Pago (de prueba), que necesita el túnel y las credenciales
`MP_CLIENT_ID` / `MP_CLIENT_SECRET` / `TOKEN_ENCRYPTION_KEY`.

`npm run db:seed:e2e` suma usuarios `e2e-*@truckpool.app` (misma contraseña) y
viajes con ids fijos para Playwright; ver [Tests](#tests).

---

## Variables de entorno

### Server (`server/.env`)

Copiá `server/.env.example`, que explica cada una. **Nunca commitear el
`.env`.** El arranque (`lib/env.ts`) aborta con la lista de lo que falta o está
mal, en vez de levantar un server inútil o inseguro.

| Variable | Para qué | Default / local | En producción |
| --- | --- | --- | --- |
| `NODE_ENV` | Entorno | `development` | `production`. Obligatoria siempre; `test` (lo pone vitest) u otro valor no arrancan |
| `DATABASE_URL` | Conexión a PostgreSQL | `postgresql://postgres:truckpool@localhost:5433/truckpool` | Obligatoria, con TLS |
| `JWT_SECRET` | Firma de los JWT | `openssl rand -hex 32` | Obligatoria. El secreto de desarrollo histórico no arranca |
| `PORT` | Puerto de la API | `4000` | El que pida el hosting |
| `API_PREFIX` | Prefijo de las rutas | `/api` | Tiene que coincidir con `VITE_API_URL` |
| `CORS_ORIGIN` | Orígenes del front, separados por coma | Sin efecto: fuera de producción se acepta cualquier `http://localhost:<puerto>` | **Obligatoria**, sin `*` |
| `TRUST_PROXY` | Proxies delante de la API, para leer la IP real | Vacío (= 0) | **Obligatoria**: la cantidad exacta del hosting (casi siempre 1). Un valor que no sea entero, `true` o `false` no arranca en ningún entorno |
| `AUTH_RATE_LIMIT_MAX` | Intentos de login/registro cada 15 min | `10` | — |
| `RATE_LIMITS` | Rate limits de las demás rutas | Vacío u `on` = prendidos; `off` solo para pruebas locales | `off` no arranca |
| `JOBS_ENABLED` | Tareas periódicas (`lib/jobs.ts`) | Vacío = prendidas. **`false` en local y en el e2e** | `true` o vacío |
| `APP_URL` | URL pública del front (back URLs del checkout, links de emails) | `http://localhost:5173` | **Obligatoria**, `https` y pública |
| `API_PUBLIC_URL` | URL pública de la API (webhook, callback de OAuth) | `http://localhost:4000` | **Obligatoria**, `https` y pública |
| `TOKEN_ENCRYPTION_KEY` | 64 hex (32 bytes) para cifrar los tokens de MP de los fleteros | Hace falta para conectar MP | **Obligatoria**, 64 hex |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | OAuth de Mercado Pago Marketplace | Hacen falta para conectar MP | **Obligatorias** |
| `MP_WEBHOOK_SECRET` | Firma de los webhooks de MP | Sin él, el webhook responde 503 | **Obligatoria**, distinta de la de prueba |
| `MP_ACCESS_TOKEN` | Token de la cuenta de la plataforma. Solo lo usan los diagnósticos de MP; los cobros usan el token de cada fletero | Opcional | No se exige (los diagnósticos no se montan) |
| `MP_OAUTH_TEST_TOKEN` | `true` pide credenciales de sandbox en el OAuth | `false` | `true` no arranca |
| `MP_CHECKOUT_SANDBOX` | `true` manda el checkout al link de sandbox | `false` | `true` no arranca |
| `RESEND_API_KEY` | Emails vía Resend | Opcional: sin ella se loguea y sigue | **Obligatoria** |
| `EMAIL_FROM` | Remitente | `TruckPool <notificaciones@truckpool.app>` | Dominio verificado en Resend |
| `NOMINATIM_URL` | Geocodificación | `https://nominatim.openstreetmap.org/search` | Evaluar un proveedor pago |
| `NOMINATIM_USER_AGENT` | User-Agent de Nominatim (su política lo exige) | `truckpool/1.0 (…; contacto@truckpool.app)` | Con un contacto real |
| `MAX_STOP_DISTANCE_FROM_ROUTE_KM` | Distancia máxima de un retiro al trayecto | `8` | — |
| `ADMIN_EMAIL` / `ADMIN_NAME` / `ADMIN_PASSWORD` | Solo para `npm run admin:create` | — | Mejor no usarlas: el script las pide por la terminal |
| `SENTRY_DSN` | Monitoreo de errores | Prevista (§4 de `docs/review/04-launch.md`), todavía no se lee | — |

En resumen, **producción no arranca sin** `NODE_ENV=production`,
`DATABASE_URL`, `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY` (64 hex),
`MP_WEBHOOK_SECRET`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `RESEND_API_KEY`,
`CORS_ORIGIN` (sin `*`), `APP_URL` y `API_PUBLIC_URL` (`https`, no localhost) y
`TRUST_PROXY`; ni con `RATE_LIMITS=off`, `MP_OAUTH_TEST_TOKEN=true` o
`MP_CHECKOUT_SANDBOX=true`.

### Client (`client/.env.local`, opcional)

| Variable | Para qué | Default |
| --- | --- | --- |
| `VITE_API_URL` | URL base de la API | `http://localhost:4000/api` |
| `VITE_SENTRY_DSN` | Monitoreo de errores | Prevista, todavía no se lee |

Todo lo que lleve prefijo `VITE_` queda **embebido en el bundle del
navegador**: jamás un secreto ahí. Se lee en el build, así que en producción va
como variable del build del hosting.

### Otras

| Dónde | Variable | Para qué |
| --- | --- | --- |
| `.env` de la raíz (docker compose) | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Credenciales del Postgres local (default `postgres` / `truckpool` / `truckpool`) |
| `.env` de la raíz (docker compose) | `PGADMIN_EMAIL`, `PGADMIN_PASSWORD` | Login de pgAdmin; sin ellas pgAdmin no arranca |
| Playwright | `E2E_API_URL` | API contra la que corre el e2e (default `http://localhost:4000/api`) |

---

## Scripts

**server/**

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor con recarga (`tsx watch src/index.ts`) |
| `npm run build` | Compila a `dist/` |
| `npm start` | Corre el build (`dist/src/index.js`) |
| `npm test` | Suite de Vitest (sin base ni red) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run db:seed` | Alias de `db:seed:demo` |
| `npm run db:seed:demo` | Usuarios y viajes demo. No corre con `NODE_ENV=production` |
| `npm run db:seed:e2e` | Usuarios `e2e-*` y viajes con ids fijos para Playwright. Borra y recrea sus viajes en cada corrida. No corre con `NODE_ENV=production` |
| `npm run db:seed:prod` | Seed de producción: idempotente, no crea usuarios. Hoy no hay datos de referencia, solo lo informa |
| `npm run admin:create` | Crea una cuenta `ADMIN` (ver [Despliegue](#despliegue)) |
| `npm run seed:geocode` | Corrige coordenadas; en seco por defecto (ver [Mantenimiento](#mantenimiento)) |
| `npx prisma generate` | Genera el cliente de Prisma |
| `npx prisma migrate dev` | Crea y aplica migraciones en desarrollo |
| `npx prisma migrate deploy` | Aplica las migraciones pendientes (CI y producción) |

**client/**

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de Vite (5173 por defecto) |
| `npm run build` | `tsc -b` + build de producción: es también el typecheck del client |
| `npm run preview` | Sirve el build |
| `npm run lint` | ESLint |
| `npx playwright test` | e2e (ver [Tests](#tests)) |

---

## Mantenimiento

### `npm run seed:geocode`: corregir coordenadas

Vuelve a geocodificar con `lib/geocode.ts` (solo Argentina, 1 pedido por
segundo, así que con muchos registros tarda). **Por defecto corre en seco**:
muestra cada cambio (antes → después) y no escribe nada. Con `--escribir`
guarda.

| Modo | Qué corrige |
| --- | --- |
| sin flag | Viajes sin coordenadas de origen o destino |
| `--fuera-de-ar` | Viajes con origen, destino o salida fuera de Argentina; sin match en Argentina, el punto queda en `null` |
| `--cargas` | Cargas activas sin ciudad de retiro (`pickupCity`): la completa con la localidad; si sus coordenadas estaban fuera de Argentina, las reemplaza (o quedan en `null`) |

```bash
cd server
npm run seed:geocode -- --fuera-de-ar             # en seco: solo muestra
npm run seed:geocode -- --fuera-de-ar --escribir  # guarda
npm run seed:geocode -- --help
```

Usa la `DATABASE_URL` del entorno: contra producción, revisá primero la corrida
en seco.

### `npm run admin:create`: cuentas de admin

Crea una cuenta `ADMIN`; si el email ya existe, aborta sin tocar nada. La forma
recomendada es correrlo sin variables: pide email, nombre y contraseña (sin eco,
mínimo 16 caracteres) por la terminal. `ADMIN_EMAIL`, `ADMIN_NAME` y
`ADMIN_PASSWORD` también funcionan, pero la contraseña por variable puede quedar
en el historial de la terminal o en el entorno del proceso: solo donde no haya
terminal (un job de un solo uso del hosting). `npm run admin:create -- --help`
muestra el uso.

---

## Despliegue

Plan de infraestructura de `docs/review/04-launch.md` §4. El
`docker-compose.yml` es solo infraestructura local: no es el despliegue.

### Frontend

SPA estática en Cloudflare Pages, Vercel o Netlify, con fallback de todas las
rutas a `index.html` (las rutas son del lado del cliente: `/viajes/:id`,
`/pagos/retorno`…).

- Build: `cd client && npm ci && npm run build` → `client/dist/`.
- `VITE_API_URL` con la URL pública de la API, como variable del build.
- Los headers de seguridad y la **CSP** del front van en el hosting (hoy no
  existen): `connect-src` a la API, `img-src` a los tiles del mapa,
  `frame-ancestors 'none'`.

### Backend

Contenedor Node en Render, Railway o Fly.io, región São Paulo.

- Build: `npm ci --include=dev && npx prisma generate && npm run build`.
  `typescript`, `prisma` y `tsx` son devDependencies, y con `NODE_ENV=production`
  `npm ci` las omite si no se le pide `--include=dev`.
- Release: `npx prisma migrate deploy`, antes de arrancar la versión nueva.
- Start: `npm start`.
- Health check: `GET /api/health` (o `/health`).
- **Una sola instancia** al inicio: los rate limits, la cola de Nominatim, la
  caché de geocoding y los jobs viven en memoria del proceso.
  - **`TRUST_PROXY` tiene que coincidir con la cantidad de proxies del
    hosting** (casi siempre 1). Si es mayor, cualquiera elige su IP con
    `X-Forwarded-For` y se saltea los rate limits; si es menor, todos los
    clientes comparten la IP del proxy y el mismo límite.
  - **Si se escala a más de una instancia**: con el store en memoria cada
    proceso cuenta por su lado, así que el límite real queda multiplicado por
    la cantidad de instancias y un redeploy resetea los contadores. El límite
    por email del login se esquiva repartiendo los intentos entre instancias.
    Hace falta un store compartido (`rate-limit-redis` o uno sobre Postgres) y
    el mismo `TRUST_PROXY` en todas. La cola de Nominatim y la caché de
    geocoding tienen el mismo problema.
- Producción no arranca sin su configuración completa (ver
  [Variables de entorno](#variables-de-entorno)) ni con `RATE_LIMITS=off`.
- **Datos iniciales**: `npm run db:seed:prod` (idempotente, sin usuarios) y el
  primer admin con `npm run admin:create`, desde una terminal con la
  `DATABASE_URL` de producción. El seed demo y el e2e no corren con
  `NODE_ENV=production`.

### Base de datos

PostgreSQL administrado (Neon, Supabase, Railway o RDS) en `sa-east-1`, con TLS
obligatorio.

- **Backups**: PITR del proveedor (≥ 7 días) + `pg_dump` diario cifrado a otro
  proveedor (30 días). Probar una restauración antes de lanzar y una vez por
  mes: `Payment` y `RefundRequest` son la contabilidad.

### Servicios externos

- **Geocoding y rutas**: Nominatim y el demo de OSRM públicos no son para
  producción con volumen. `NOMINATIM_USER_AGENT` con un contacto real, y
  evaluar un proveedor pago vía `NOMINATIM_URL`.
- **Dominio y mails**: `app.` y `api.` del dominio propio; Resend con dominio
  verificado (SPF, DKIM, DMARC), `EMAIL_FROM` tipo `TruckPool <avisos@…>` y
  reply-to a soporte.
- **Monitoreo** (pendiente): Sentry en server y client con `beforeSend` que
  borre `Authorization`, cookies y bodies; uptime check sobre el health;
  alertas por `RefundRequest` FAILED o PENDING > 1 h y por webhooks con 401/503.

### Mercado Pago

- **Pruebas**: túnel HTTPS (`cloudflared tunnel` o ngrok) a la API local →
  `API_PUBLIC_URL`; `APP_URL` al front de staging. Webhook en el panel de la app
  de MP con su secret. Usuarios de prueba: vendedor (fletero vía OAuth) y
  comprador (empresa). No exponer el inspector del túnel. Lo ideal es un
  staging desplegado con credenciales de prueba.
- **Producción**: credenciales productivas de la app Marketplace; redirect URI
  de OAuth exacta al callback de `API_PUBLIC_URL`
  (`/api/users/me/mp-callback`); webhook productivo
  (`/api/payments/webhook`) con un secret distinto del de prueba.
- **Checklist de homologación**: `external_reference`, `notification_url`,
  `back_urls` + `auto_return`, `statement_descriptor`, ítems completos (título,
  descripción, categoría, cantidad, precio), email del pagador,
  `marketplace_fee`, vencimiento de la preferencia alineado con las 24 h de la
  reserva, idempotency key en pagos y reembolsos, reembolso parcial probado,
  `payment.updated` manejado. Correr el quality checklist/evaluación de MP antes
  de pedir la homologación.

### Legal

Términos y condiciones (política de retiro incluida), política de privacidad
(Ley 25.326) y facturación de la comisión.

---

## Decisiones de diseño

**Concurrencia al reservar espacio.** `addCargoItem` corre en una transacción
`Serializable` con reintento ante `P2034` (conflicto de serialización). Dos
empresas reservando el último m³ al mismo tiempo es el caso normal, no el
excepcional: sin aislamiento serializable, las dos leen "queda 1" y las dos
escriben. El geocode y OSRM corren antes de la transacción, nunca adentro.

**Cálculo de precio server-side.** El `priceShare` lo calcula la API a partir de
los m³ y el precio total del viaje (`lib/pricing.ts`). El cliente manda volumen,
nunca dinero: un `priceShare` que venga del front es un `priceShare` que alguien
puede elegir.

**Depósito congelado.** Ver arriba: la seña se fija al crear la carga, no se
recalcula. Cambiar el porcentaje del viaje después no invalida reservas ya
pagadas.

**Penalización por ventana temporal.** `>48 h` sin costo · `24–48 h` mitad de la
seña · `<24 h` la seña completa (`lib/cancellation.ts`). La empresa la ve
**antes** de confirmar el retiro, con
`GET /api/trips/:tripId/cargo-items/:cargoItemId/cancellation-quote`, que ya
descuenta lo que pagó ($ 0 si no pagó la seña): ve el número y no una sorpresa.
Hasta la salida se puede retirar también una carga confirmada, con la misma
penalidad.

**Geocodificación best-effort.** Nominatim se consulta de a uno (1 req/s, caché
24 h) para no comerse el rate limit del servicio público. Si falla, el viaje se
publica igual: perder el mapa es molesto, perder el viaje es un bug. Lo mismo
con los emails: un envío que falla nunca frena la operación.

**Solo Argentina.** Nominatim busca con `countrycodes=ar`: sin eso "Córdoba"
caía en España y el viaje quedaba con un pin a 10.000 km. Una coordenada en
otro país es peor que ninguna. Al publicar se muestra el lugar resuelto en texto
("Córdoba, Córdoba, Argentina") para que el fletero lo confirme. Los datos
viejos se corrigen con `npm run seed:geocode -- --fuera-de-ar`.

**El precio sugerido es una referencia.** La sugerencia depende de un geocode
best-effort, así que no puede ser un límite: el fletero publica el precio que
quiera y, fuera del ±15 % del sugerido, ve un aviso que no bloquea. Con más de
5.000 km entre las puntas (más que cualquier viaje dentro del país) no se sugiere
nada: casi seguro una punta se resolvió mal.

**Las coordenadas exactas no se exponen.** Las respuestas públicas no incluyen
lat/lng exactos; se usan server-side para ordenar por distancia y el radio se
filtra en el servidor. De la carga de otra empresa se muestra solo el volumen y
la localidad del retiro (`pickupCity`, la que resolvió el geocode), nunca la
dirección.

**Métricas de admin honestas.** `getAdminStats` devuelve `null` en vez de `0`
cuando una métrica depende de una fase no implementada, y agrega una nota
explicando por qué. Un dashboard con ceros falsos es peor que uno con huecos.

**Mappers como frontera de serialización.** Todo lo que sale de la API pasa por
`lib/mappers.ts`. Los tokens de Mercado Pago y los campos internos nunca se
serializan porque no están en el mapper, no porque alguien se acuerde de
omitirlos.

---

## Seguridad

- **Headers**: `helmet` con CSP `default-src 'none'` (la API devuelve JSON y PDF,
  no necesita cargar nada), `frame-ancestors 'none'`, `referrer-policy:
  no-referrer`, HSTS y `upgrade-insecure-requests` **solo en producción** (en
  local romperían el `http://localhost`).
- **CORS**: en desarrollo acepta `http://localhost:<puerto>`; en producción usa
  la lista explícita de `CORS_ORIGIN`. Nunca comodines.
- **Rate limiting** en login y registro (10 intentos / 15 min por IP,
  `AUTH_RATE_LIMIT_MAX`, y el login además por email). En el login solo cuentan
  los fallidos. El limitador corre **antes** de validar el body: mandar basura
  también tiene que contar. Reservas, pagos, mensajes, solicitudes, tracking,
  geocode y cotizaciones tienen su propio límite (`lib/rateLimit.ts`).
- **Contraseñas** con `bcryptjs`, nunca reversibles ni en logs.
- **JWT** de 7 días, con `jti`; `POST /logout` lo revoca en la base
  (`RevokedToken`). `requireAuth` consulta la revocación en cada request.
- **Ownership verificado en el service**, no en el controller: manifiesto,
  mensajes, GPS, paradas, reviews, cargas y pagos chequean que el usuario sea el
  transportista del viaje o la empresa con una carga activa. Los mensajes
  además restringen el `toUserId` a las contrapartes reales del viaje.
- **Solo la empresa califica**: `POST /:id/reviews` exige `COMPANY`, y el
  service vuelve a verificar el rol aunque el middleware ya lo hizo. El
  destinatario de la reseña no lo elige el cliente: es siempre el fletero del
  viaje, derivado del viaje.
- **Marketplace OAuth**: el `state` del callback está firmado, con `purpose` y
  expiración de 10 minutos. El `userId` sale del token verificado, nunca de un
  parámetro de la request.
- **Webhooks de MP** con HMAC-SHA256 y `timingSafeEqual`. Sin secreto
  configurado, el endpoint falla cerrado (503) en vez de aceptar.
- **Tokens de MP cifrados** con AES-256-GCM en la base. El SDK de MP y
  `MP_ACCESS_TOKEN` solo se tocan en `server/lib/mercadopago.ts`, y los
  diagnósticos que usan el token de la plataforma no se montan en producción.
- **Errores sanitizados**: un `AppError` con código interno propio; los errores
  del SDK de MP no se re-logan crudos porque pueden llevar headers de
  autenticación.
- **Arranque defensivo**: `lib/env.ts` aborta el proceso si falta configuración,
  si detecta el secreto JWT de desarrollo histórico o, en producción, si falta
  algo de lo que exige o hay una bandera de prueba prendida.
- **El `.env` está en `.gitignore`** y nunca fue commiteado.

---

## Tests

### Server

```bash
cd server
npm test                                   # toda la suite
npx vitest run tests/trips.service.test.ts # un archivo
```

Vitest + supertest, en `server/tests/`. Cada archivo mockea Prisma, Mercado
Pago, Nominatim, OSRM y el email con `vi.mock`: **no hace falta base de datos
ni red**. `tests/setup.ts` fija `JWT_SECRET` y `TOKEN_ENCRYPTION_KEY`. Los mocks
de Mercado Pago usan tokens ficticios: ningún test toca una cuenta real.

Cubren el pipeline HTTP (errores, 404, CORS, permisos), los services de viajes,
usuarios, pagos, reembolsos y conciliación, el SDK de MP y la firma del
webhook, headers y rate limits, la validación del entorno, el cifrado, precios
y penalizaciones, jobs, tracking, geocoding, mappers, emails, seeds y
`admin:create`.

### Client

El client no tiene tests unitarios: la validación es `npm run lint` y
`npm run build` (que incluye el typecheck). Los e2e de Playwright están en
`client/tests-e2e/` y corren contra la app de verdad:

```bash
# con Postgres, migraciones y el seed demo hechos (ver Pasos para levantarlo)
cd server && JOBS_ENABLED=false npm run dev    # API en :4000
cd client && npx playwright install chromium   # la primera vez
cd client && npx playwright test
```

Playwright levanta el client en `:5174` (o reusa el que ya esté ahí) y antes de
correr ejecuta `npm run db:seed:e2e` en `server/`. Necesita también el seed
demo: los specs de admin usan `admin@truckpool.app`, que el seed e2e no crea.

---

## Estructura del repositorio

Dos proyectos npm independientes (`server/` y `client/`), sin workspace en la
raíz: cada comando se corre dentro de su carpeta.

```
truckpool/
├─ client/                    React 19 + Vite
│  ├─ src/
│  │  ├─ api/client.ts        fetch + JWT (localStorage) + ApiError con el code
│  │  ├─ components/          UI (incluye components/landing/)
│  │  ├─ hooks/               un hook de TanStack Query por consulta/mutación
│  │  ├─ lib/                 formato, geo, SEO, cotización de retiro, queries
│  │  ├─ pages/               16 páginas (rutas en src/main.tsx)
│  │  ├─ types/
│  │  ├─ index.css            tema de Tailwind v4
│  │  └─ main.tsx             router
│  ├─ public/                 favicon, og.png, robots.txt, sitemap.xml
│  ├─ tests-e2e/              specs de Playwright + fixtures y global-setup
│  └─ playwright.config.ts
│
├─ server/                    Express 5 + Prisma
│  ├─ src/                    app.ts (pipeline) · index.ts (bootstrap)
│  ├─ lib/                    env, auth, errors, mappers, validate, crypto,
│  │                          mercadopago, geocode, routing, pricing,
│  │                          cancellation, reservations, jobs, email,
│  │                          notifications, manifestPdf, rateLimit, security…
│  ├─ modules/                auth · trips · users · payments · notifications
│  ├─ prisma/
│  │  ├─ migrations/
│  │  ├─ seed-demo.ts         + demo-seed.ts (bloqueado en producción)
│  │  ├─ seed-e2e.ts          datos fijos para Playwright
│  │  ├─ seed-prod.ts         idempotente, sin usuarios
│  │  ├─ create-admin.ts      npm run admin:create
│  │  └─ backfill-geocode.ts  npm run seed:geocode
│  ├─ schema.prisma           12 modelos, 10 enums
│  ├─ prisma.config.ts        ruta del schema, migraciones y seed
│  ├─ types/
│  ├─ tests/                  Vitest (+ helpers/ y setup.ts)
│  └─ .env.example
│
├─ docs/review/               revisiones y plan de lanzamiento
├─ docker-compose.yml         PostgreSQL + pgAdmin (solo local)
├─ CLAUDE.md
└─ README.md
```

---

<div align="center">

**TruckPool**: armado con Express, Prisma, React y Mercado Pago.

</div>
