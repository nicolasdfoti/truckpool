<div align="center">

# TruckPool

**Marketplace de transporte de carga compartida.**

Los transportistas publican los viajes que ya van a hacer igual, ocupando el
espacio que sobra en el camión. Las empresas les compran ese espacio:
cargan su mercadería, pagan una seña por reservar y el resto al llegar. Sin
camiones vacíos, sin fletes urgente pagados al doble, sin gastar combustible
en kilos de aire.

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
| Cobra por `priceShare` de cada carga confirmada | Paga seña al reservar, saldo al llegar |
| Decide fechas de carga/recolecta y reparte | Sigue su carga por código de tracking |

El resultado: el transportista no cambia su ruta y factura un flete que ya
estaba haciendo; la empresa evita el flete completo.

---

## Los tres roles

| Rol | Qué hace | Cómo se entra |
| --- | --- | --- |
| **`COMPANY`** | Publica solicitudes de carga, reserva espacio en viajes abiertos, paga señas, sigue el tracking, califica | `POST /api/auth/register` |
| **`CARRIER`** | Publica viajes, acepta solicitudes, sube GPS, gestiona paradas y manifest, cobra | `POST /api/auth/register` |
| **`ADMIN`** | Aprueba/rechaza verificaciones de identidad, ve métricas de la plataforma | Solo por seed (no hay registro público de admin) |

La verificación de identidad (`UNVERIFIED → PENDING → VERIFIED | REJECTED`) es
obligatoria para que un transportista pueda publicar: el admin la aprueba desde
`/api/admin/verifications`. No existe endpoint HTTP para crear ni promover a
`ADMIN`; esa cuentas nacen del seed.

---

## Cómo funciona un viaje de punta a punta

```
1.  CARRIER publica un viaje
    origen → destino, fecha, tipo de camión, m³, precio total
    ↓
2.  El sistema geocodifica origen, destino y punto de salida (Nominatim, cache 24 h)
    ↓
3.  COMPANY ve el viaje en el mapa y reserva espacio
    se prorratea el precio por m³ → priceShare
    se congela la seña (depositPercent, default 20 %)
    ↓
4.  COMPANY paga la seña con Mercado Pago
    el pago entra en la cuenta del CARRIER y la plataforma retiene su comisión
    ↓
5.  CARRIER acepta la carga → la empresa elige cuándo se carga
    la carga pasa PENDING → CONFIRMED
    ↓
6.  CARRIER ordena las paradas de recogida y publica la hoja de ruta
    ↓
7.  Durante el viaje: GPS en vivo, chat, tracking público por código
    ↓
8.  Al llegar: la empresa paga el saldo, ambas partes se califican
    ↓
9.  ADMIN ve las métricas de la plataforma
```

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
- **Estimación de precio en vivo** (`GET /api/trips/price-estimate`) antes de
  reservar, y **cotización de cancelación** (`GET /api/trips/cancellation-quote`)
  con la penalización real según cuán cerca está la fecha del viaje.
- Solicitudes de viaje inversas (`TripRequest`) cuando la empresa no encuentra
  capacidad y prefiere que sea el transportista el que publique.
- Reseñas bilaterales: cada parte califica a la otra una sola vez, solo en viajes
  `COMPLETED`, y las dos calificaciones se muestran en el perfil público.

### Pagos con Mercado Pago

- Checkout con **Mercado Pago Checkout Pro** para la seña (`DEPOSIT`) y el saldo
  (`BALANCE`).
- El pago se crea **en la cuenta del transportista** (Marketplace / OAuth), no en
  una cuenta de la plataforma: la plata va al que transporta.
- Comisión de plataforma (`platformFeePercent`, default 10 %) retenida sobre cada
  `priceShare` confirmado.
- **Reembolsos** con `refundPayment` y estado `REFUNDED` en la base.
- **Webhooks** firmados con HMAC-SHA256 y comparación en tiempo constante
  (`timingSafeEqual`) — sin la firma correcta, la petición se rechaza.
- Tokens de transportista guardados **cifrados** en la base con AES
  (`TOKEN_ENCRYPTION_KEY`), nunca devueltos por la API.
- Sanitized errors: los errores de Mercado Pago se traducen a códigos internos
  (`MP_ERROR`, `MP_INVALID_RESPONSE`, `MP_NOT_CONFIGURED`) sin filtrar el
  request crudo, que puede contener headers con el token.

### Operación del viaje

- **Tracking GPS en vivo** con Leaflet, línea de tiempo del recorrido y
  actualización de la posición cada vez que el transportista reporta.
- **Hoja de ruta**: reordenamiento manual de paradas con drag & drop
  (`@dnd-kit`), con orden automático por proyección sobre la línea
  origen-destino cuando el transportista no lo customiza.
- **Manifest PDF** generado con PDFKit, firmado por el transportista y la
  empresa, descargable por los dos lados del viaje.
- **Chat por viaje** con hilo de mensajes y marca de leídos.
- **Tracking público** por código corto (`TP-xxxx-C1`) para el receptor final de
  la mercadería, sin necesidad de cuenta: origen, destino, fecha y estado.

### Plataforma

- Notificaciones in-app por tipo (`MESSAGE`, `CARGO_ADDED`, `CARGO_CONFIRMED`,
  `CARGO_CANCELLED`, `TRIP_STATUS_CHANGED`, `PAYMENT_APPROVED`, `BALANCE_DUE`,
  `TRIP_REQUEST`, `TRIP_REQUEST_RESPONSE`), con campana y contador de no leídas.
- Emails transaccionales vía **Resend** (opt-out por usuario), con templates
  para cada evento del ciclo de vida del viaje.
- Panel de admin: verificaciones pendientes y métricas de la plataforma
  (viajes por estado, volumen confirmado, facturado, rating promedio, conteo de
  transportistas y empresas).
- SEO por ruta: título y description dinámicos en cada página.
- `AppErrorBoundary` y páginas `404` propias.

---

## Stack técnico

**Frontend** — React 19 · Vite 8 · TypeScript 6 · Tailwind CSS 4 ·
TanStack Query 5 · React Router 7 · Leaflet + react-leaflet · @dnd-kit ·
Playwright

**Backend** — Node 20.19+ · Express 5 · TypeScript 6 (ESM) · Prisma 7 ·
PostgreSQL 16 · Zod 4 · jsonwebtoken · bcryptjs · helmet · cors ·
express-rate-limit · mercadopago · pdfkit · dotenv

**Testing** — Vitest 4 (backend) · Playwright (frontend) · supertest (E2E de API)

**Tooling** — ESLint 10 (flat config) · Prettier 3 · tsx · Docker Compose

### Por qué estas elecciones

- **Express 5 + ESM**: el sistema de errores async es nativo (un `throw` en un
  handler llega al error middleware sin `next(err)`), y el `"type": "module"`
  + `"type": "commonjs"` dual de Prisma se resuelve con imports explícitos
  `.js` en el código fuente.
- **Prisma 7 con `@prisma/adapter-pg`**: el adapter permite conexiones
  gestionadas y pool propio en vez del engine binario nativo.
- **Zod como única fuente de validación**: los schemas viven junto al módulo
  (`*.schemas.ts`) y un middleware genérico (`validateBody` / `validateQuery`)
  los aplica a las rutas. No hay validación repetida en los controllers.
- **TanStack Query**: el backend es la fuente de verdad; los hooks manejan
  cache, invalidación por mutación y reintentos sin boilerplate.
- **Tailwind v4 con `@tailwindcss/vite`**: sin `tailwind.config.js`, el tema va
  por CSS.

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────┐
│  client/  React 19 (SPA)                                 │
│  pages/ · components/ · hooks/ · api/ · lib/             │
└───────────────────────┬──────────────────────────────────┘
                        │  fetch  ·  Bearer JWT
                        │  VITE_API_URL
┌───────────────────────▼──────────────────────────────────┐
│  server/  Express 5                                      │
│                                                           │
│  src/app.ts        pipeline: helmet → json → cors →       │
│                    routes → 404 → errorHandler           │
│  modules/          auth · trips · users · payments ·     │
│                    notifications (routes/controller/      │
│                    service/schemas por módulo)            │
│  lib/              auth · validate · crypto · env ·      │
│                    mercadopago · geocode · email ·        │
│                    notifications · pdf · rateLimit        │
└───────────────────────┬──────────────────────────────────┘
                        │  Prisma Client (@prisma/adapter-pg)
┌───────────────────────▼──────────────────────────────────┐
│  PostgreSQL 16  ·  21 migraciones                         │
└──────────────────────────────────────────────────────────┘

  Servicios externos (server-side only)
  ├─ Mercado Pago API    preferencias, pagos, reembolsos, OAuth
  ├─ Nominatim           geocodificación (cache 24 h, 1 req/s)
  └─ Resend              emails transaccionales
```

**Flujo de una request:** `middleware → validate (Zod) → requireAuth /
requireRole → controller → service (ownership + lógica) → Prisma → mapper →
response`. Los controllers no hablan con Prisma; los services no tocan `req`/
`res`.

**Sistema de archivos por módulo**, en `server/modules/<módulo>/`:

```
<módulo>.routes.ts       rutas + cadena de guards
< módulo>.controller.ts  req/res, llama al service
<módulo>.service.ts      lógica de negocio y ownership
<módulo>.schemas.ts      schemas Zod
```

---

## Modelo de datos

11 modelos y 9 enums. Los tres centrales:

```
Trip (publicada por un CARRIER)
 ├─ CargoItem[]           Cargas de COMPANY sobre ese viaje
 │   ├─ Payment[]         DEPOSIT (seña) y BALANCE (saldo)
 │   └─ trackingCode      código público único
 ├─ Message[]             chat del viaje
 ├─ TripLocation[]        puntos GPS
 └─ Review[]              calificaciones bilaterales

User (COMPANY | CARRIER | ADMIN)
 ├─ cargoItems[]          como empresa
 ├─ trips[]               como transportista
 ├─ tripRequestsSent / Received
 └─ mpAccessToken         cifrado, nunca expuesto
```

**Ciclo de vida de un viaje:**
`OPEN → FULL → IN_TRANSIT → COMPLETED`

**Ciclo de vida de una carga:**
`PENDING → CONFIRMED` (o `→ CANCELLED` con penalización)

**Estados de pago:** `PENDING → APPROVED | REJECTED → REFUNDED`

**Decisiones de schema que vale la pena conocer:**

- `price` y `priceShare` son `Decimal(12,2)`, nunca `Float`: son plata.
- **`capacityUsed` no existe como columna.** Se calcula sumando
  `CargoItem.volume` en el momento. Un valor desnormalizado se desincroniza
  apenas alguien cancela; una suma nunca miente.
- `depositAmount` se **congela** al crear la carga. Si el transportista después
  cambia `depositPercent` del viaje, las reservas ya hechas siguen valiendo lo
  que valían.
- `departureTime` es `String?` con formato `HH:mm` y se muestra pegado a la
  fecha del viaje. No se guarda como `timestamp` para no pelearse con la zona
  horaria del navegador.
- Las coordenadas (`originLat`, `originLat`…) son **opcionales a propósito**.
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

Todas bajo `/api`, salvo `/health`. `Bearer` = JWT required.
`role:X` = además requiere ese rol.

### Auth — `/api/auth`

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| POST | `/register` | — | Crea `COMPANY` o `CARRIER`, rate-limited |
| POST | `/login` | — | `{ token, user }`, rate-limited |
| GET | `/me` | Bearer | Usuario de la sesión |
| POST | `/logout` | Bearer | Revoca el `jti` del token |

### Viajes — `/api/trips`

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| GET | `/` | — | Viajes abiertos, con filtros y radio |
| GET | `/geocode?address=` | — | Dirección → coordenadas |
| GET | `/price-estimate` | — | Prorrateo del precio por m³ |
| GET | `/cancellation-quote` | — | Penalización según la fecha |
| GET | `/:id` | — | Detalle con carga |
| POST | `/` | role:CARRIER | Publica viaje |
| POST | `/:id/cargo-items` | role:COMPANY | Reserva espacio |
| DELETE | `/:tripId/cargo-items/:cargoItemId` | role:COMPANY | Cancela carga |
| PATCH | `/:tripId/cargo-items/:cargoItemId` | Bearer | Confirma carga |
| PATCH | `/:id/status` | role:CARRIER | Avanza el estado |
| GET | `/:id/manifest.pdf` | participante | Hoja de ruta en PDF |
| GET | `/:id/route` | Bearer | Paradas + pickups |
| GET | `/:id/route-geometry` | Bearer | Línea de la ruta |
| GET | `/:id/location` | participante | Tracking GPS |
| POST | `/:id/location` | role:CARRIER | Reporta posición |
| GET | `/:id/stops` | role:CARRIER | Paradas ordenadas |
| PATCH | `/:id/stops/reorder` | role:CARRIER | Reordena paradas |
| GET | `/:id/messages` | participante | Chat del viaje |
| POST | `/:id/messages` | participante | Envía mensaje |
| PATCH | `/:id/messages/read` | participante | Marca leídos |
| POST | `/:id/reviews` | participante | Califica (1 vez) |

### Tracking

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| GET | `/api/tracking/:trackingCode` | — | Seguimiento público |

### Pagos — `/api/payments`

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| POST | `/cargo-items/:id/payment-preference` | role:COMPANY | Checkout MP |
| POST | `/payments/webhook` | firma MP | Notificaciones MP |
| GET | `/payments/mp/test` | role:ADMIN | Diagnóstico MP |
| POST | `/payments/mp/test-preference` | role:ADMIN | Preferencia de prueba |

### Usuarios — `/api/users`

| Método | Ruta | Auth | |
| --- | --- | --- | --- |
| GET/PATCH | `/me` | Bearer | Perfil |
| GET | `/me/trips` | Bearer | Viajes como transportista |
| GET | `/me/cargo-items` | role:COMPANY | Cargas como empresa |
| PATCH | `/me/availability` | role:CARRIER | "Disponible ahora" |
| PATCH | `/me/verification` | role:CARRIER | Solicita verificación |
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
| GET | `/api/carriers/:id` | — | Perfil público |
| GET | `/api/notifications` | Bearer | Bandeja del usuario |
| PATCH | `/api/notifications/:id/read` | Bearer | Marca una como leída |
| PATCH | `/api/notifications/read-all` | Bearer | Marca todas |
| GET | `/api/admin/stats` | role:ADMIN | Métricas |
| GET | `/api/admin/verifications` | role:ADMIN | Pendientes |
| PATCH | `/api/admin/verifications/:userId` | role:ADMIN | Aprueba / rechaza |

---

## Pasos para levantarlo

**Requisitos:** Node 20.19+ (o 22.12+) y Docker, para el PostgreSQL.

```bash
# 1. Base de datos
docker compose up -d
#    PostgreSQL en :5433 · pgAdmin en http://localhost:5051

# 2. Backend
cd server
cp .env.example .env      # ajustá DATABASE_URL
npm install
npx prisma migrate dev    # o: npx prisma db push
npm run db:seed           # usuarios y viajes de ejemplo
npm run dev               # http://localhost:4000

# 3. Frontend (otra terminal)
cd client
npm install
npm run dev -- --port 5173
```

### Usuarios demo (del seed)

| Rol | Email | Password |
| --- | --- | --- |
| `CARRIER` | `flete@truckpool.app` | `truckpool123` |
| `COMPANY` | `empresa@truckpool.app` | `truckpool123` |
| `ADMIN` | `admin@truckpool.app` | `truckpool123` |

Para que el transportista pueda publicar, primero hay que aprobarlo desde
`/admin/verificaciones`.

---

## Variables de entorno

`server/.env` (copiá `.env.example`). **Nunca commitear.**

| Variable | Para qué |
| --- | --- |
| `DATABASE_URL` | Conexión a PostgreSQL |
| `JWT_SECRET` | Firma de los tokens (64 hex recomendado) |
| `CORS_ORIGIN` | Orígenes permitidos, separados por comas |
| `PORT` | Puerto de la API (4000) |
| `TRUST_PROXY` | Saltos de proxy para tomar la IP real |
| `AUTH_RATE_LIMIT_MAX` | Máx. intentos de auth (default 10) |
| `MP_ACCESS_TOKEN` | Token de la cuenta de la plataforma |
| `MP_WEBHOOK_SECRET` | Firma de los webhooks de MP |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | OAuth de Mercado Pago Marketplace |
| `TOKEN_ENCRYPTION_KEY` | 64 hex (32 bytes) para cifrar tokens MP |
| `RESEND_API_KEY` | API key de Resend |
| `EMAIL_FROM` | Remitente verificado |
| `APP_URL` / `API_PUBLIC_URL` | URLs públicas (tracking, OAuth redirect) |
| `NOMINATIM_URL` / `NOMINATIM_USER_AGENT` | Geocodificación |

En `client/`, sólo `VITE_API_URL` (default `http://localhost:4000/api`). Todo lo
que lleve prefijo `VITE_` queda **embebido en el bundle del navegador**:
jamás un secreto ahí.

---

## Scripts

**server/**

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor con recarga (`tsx watch`) |
| `npm run build` | Compila a `dist/` |
| `npm start` | Corre el build |
| `npm test` | Suite de Vitest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run db:seed` | Usuarios y viajes de ejemplo |
| `npm run seed:geocode` | Rellena coordenadas de viajes ya publicados |

**client/**

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de Vite |
| `npm run build` | Build de producción |
| `npm run preview` | Sirve el build |
| `npm run lint` | ESLint |

---

## Decisiones de diseño

**Concurrencia al reservar espacio.** `addCargoItem` corre en una transacción
`Serializable` con reintento ante `P2034` (deadlock). Dos empresas reservando el
último m³ al mismo tiempo es el caso normal, no el excepcional: sin
aislamiento serializable, las dos leen "queda 1" y las dos escriben.

**Cálculo de precio server-side.** El `priceShare` lo calcula la API a partir de
los m³ y el precio total del viaje. El cliente manda volumen, nunca dinero: un
`priceShare` que venga del front es un `priceShare` que alguien puede elegir.

**Depósito congelado.** Ver arriba: la seña se fija al crear la carga, no se
recalcula. Cambiar el porcentaje del viaje después no invalida reservas ya
pagadas.

**Penalización por ventana temporal.** `>48 h` sin costo · `24–48 h` mitad de la
seña · `<24 h` la seña completa. Vive en el service y se devuelve por
`/cancellation-quote` **antes** de confirmar, para que la empresa vea el número
y no una sorpresa.

**Geocodificación best-effort.** Nominatim se consulta de a uno (1 req/s, cache
24 h) para no comerse el rate limit del servicio público. Si falla, el viaje se
publica igual: perder el mapa es molesto, perder el viaje es un bug.

**Las coordenadas exactas no se exponen.** Las respuestas públicas no incluyen
lat/lng exactos; se usan server-side para ordenar por distancia y el radio se
filtra en el servidor.

**Notificaciones de admin honestas.** `getAdminStats` devuelve `null` en vez de
`0` cuando una métrica depende de una fase no implementada, y agrega una nota
explícando por qué. Un dashboard con ceros falsos es peor que uno con huecos.

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
  `AUTH_RATE_LIMIT_MAX`). En el login solo cuentan los fallidos
  (`skipSuccessfulRequests`). El limitador corre **antes** de validar el body:
  mandar basura también tiene que contar.
- **Contraseñas** con `bcryptjs`, nunca reversibles ni en logs.
- **JWT** de 7 días, con `jti`; `POST /logout` lo revoca en la base
  (`RevokedToken`). `requireAuth` consulta la revocación en cada request.
- **Ownership verificado en el service**, no en el controller: manifiesto,
  mensajes, GPS, paradas, reviews, cargas y pagos chequean que el usuario sea el
  transportista del viaje o la empresa con una carga activa. Los mensajes
  además restringen el `toUserId` a las contrapartes reales del viaje.
- **Marketplace OAuth**: el `state` del callback está firmado, con `purpose` y
  expiración de 10 minutos. El `userId` sale del token verificado, nunca de un
  parámetro de la request.
- **Webhooks de MP** con HMAC-SHA256 y `timingSafeEqual`. Sin secreto
  configurado, el endpoint falla cerrado (503) en vez de aceptar.
- **Tokens de MP cifrados** con AES en la base; el `Access Token` de la
  plataforma solo se lee de `process.env` y jamás sale de
  `server/lib/mercadopago.ts`.
- **Errores sanitizados**: un `AppError` con código interno propio; los errores
  del SDK de MP no se re-logan crudos porque pueden llevar headers de
  autenticación.
- **Arranque defensivo**: `lib/env.ts` aborta el proceso si detecta el secreto
  JWT de desarrollo histórico o credenciales de ejemplo.
- **El `.env` está en `.gitignore`** y nunca fue commiteado.

---

## Tests

```bash
cd server && npm test
```

**498 tests** con Vitest + supertest, sobre 13 archivos:

| Archivo | Qué cubre |
| --- | --- |
| `app.test.ts` | Pipeline HTTP completo, errores, 404, CORS, permisos |
| `trips.service.test.ts` | Publicación, carga, estados, GPS, mensajes, reviews |
| `users.service.test.ts` | Perfil, verificación, solicitudes, OAuth |
| `payments.service.test.ts` | Checkout, balance, reembolsos, split |
| `mercadopago.test.ts` | Preference, Payment, firma de webhook, sanitizado |
| `security.test.ts` | Headers, CORS, rate limit, CSP |
| `auth.secret.test.ts` | Rechazo del secreto JWT de desarrollo |
| `crypto.test.ts` | Cifrado/descifrado de tokens y validaciones |
| `env.test.ts` | Carga y validación de variables |
| `pricing.test.ts` | Prorrateo y penalizaciones |
| `notifications.test.ts` | Creación, listado, marcado de leídos |
| `route.test.ts` | Hoja de ruta, paradas, geometría |
| `email.test.ts` | Templates y envío |

Los mocks de Mercado Pago usan tokens ficticios
(`APP_USR-mp-token-plano`): ningún test toca la red ni una cuenta real.

En el frontend hay specs de Playwright bajo `client/tests-e2e/`; la validación
principal del cliente es `typecheck` + `lint` + `build`.

---

## Estructura del repositorio

```
truckpool/
├─ client/                    React 19 + Vite
│  ├─ src/
│  │  ├─ api/                 cliente fetch + interceptores
│  │  ├─ components/          UI (incluye components/landing/)
│  │  ├─ hooks/               un hook por mutación/consulta
│  │  ├─ lib/                 geo, SEO, reglas de cancelación, queries
│  │  ├─ pages/               16 páginas
│  │  └─ types/
│  └─ tests-e2e/              specs de Playwright
│
├─ server/                    Express 5 + Prisma
│  ├─ prisma/
│  │  ├─ schema.prisma        11 modelos, 9 enums
│  │  ├─ seed.ts              usuarios y viajes demo
│  │  └─ migrations/
│  ├─ lib/                    auth, crypto, env, mercadopago, geocode,
│  │                          email, pdf, mappers, validate, rateLimit…
│  ├─ modules/                auth · trips · users · payments · notifications
│  ├─ src/                    app.ts (pipeline) · index.ts (bootstrap)
│  ├─ tests/                  13 archivos de test
│  └─ .env.example
│
├─ docker-compose.yml         PostgreSQL + pgAdmin
└─ README.md
```

---

<div align="center">

**TruckPool** — armado con Express, Prisma, React y Mercado Pago.

</div>
