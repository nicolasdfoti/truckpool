# 02 — Seguridad y pagos (Fase B)
Complementa `01-arquitectura.md`. Rutas relativas a `server/` salvo `client/…`.
Método: entry points → guard chain → ownership en service → serialización. Trail of Bits
(insecure-defaults, fp-check) y security-guidance no estaban instalados como skills; se aplicó
su checklist a mano. "Bloquea" = no salir a producción con plata real sin arreglarlo.

## Parte 1 — Clasificación de la sección 2 de 01

| # | Hallazgo | Sev. | Escenario de explotación | Bloquea | Fix |
|---|---|---|---|---|---|
| 1 | Mapper por omisión + `GET /trips/:id` público | Alta | Un anónimo recorre los ids del listado público y obtiene dirección y coords exactas de retiro, descripción de la mercadería, `companyId`, `trackingCode` y estado/montos de pago de cada empresa: mapa listo para robo de carga o espionaje comercial. | sí | DTO público por whitelist (sin cargas ni pagos); el detalle completo solo para participantes. |
| 2 | `/payments/mp/:id` tapa `/payments/mp/test` | Baja | Sin impacto de seguridad: `tracePayment("test")` da 404 a no-admin. Solo rompe el diagnóstico. | no | Registrar `/mp/test` antes de `/:id` o borrar los endpoints de diagnóstico. |
| 3 | HMAC a medias (body `data.status`, `?preference_id`/`?payment_id` sin firmar, sin frescura de `ts`) | Alta | Quien consiga **una** notificación firmada (logs de túnel/proxy, inspector de ngrok) la reenvía para siempre cambiando `data.status=approved` y `?preference_id=<otro pago>`: marca cualquier seña/saldo como APPROVED sin pagar. Verificado: la firma usa `body.data.id` (`payments.controller.ts:54`) y el lookup prioriza los query params (`payments.service.ts:297-318`). | sí | Ignorar `data.status`; buscar solo por el id firmado y consultar el estado a MP; rechazar `ts` fuera de ±5 min. |
| 4 | Estados de pago sin guardia | Media | Un webhook tardío o reenviado (o el replay de #3) hace REFUNDED→APPROVED: la empresa queda con la seña "acreditada" y puede confirmar sin haber pagado; o APPROVED→REJECTED deja una carga confirmada sin seña. | no* | Máquina de estados explícita: solo transiciones válidas (`PENDING→APPROVED|REJECTED`, `APPROVED→REFUNDED`). *Bloquea junto con #3. |
| 5 | Penalidad 24–48 h se pierde | Alta | Sin atacante: la empresa cancela a 30 h, el outbox reembolsa 50 %, el `payment.updated` que dispara el propio refund entra en la rama CANCELLED y devuelve el 100 %. El fletero pierde sistemáticamente la penalidad. | sí | En la rama CANCELLED no reembolsar si ya hay `RefundRequest`/`refundedAmount`; el monto sale de la política, no de `payment.amount`. |
| 6 | Token de plataforma para pagos del carrier | Alta | Con webhooks reales (sin `data.status`), `fetchPaymentState` consulta con el token equivocado → 404 → ningún pago se acredita y todos los reembolsos fallan: la empresa nunca recupera su seña. Integridad/disponibilidad del dinero. | sí | Resolver el token descifrado del carrier del pago (como en `createCheckoutPreference`) para fetch/refund/refundedAmount. |
| 7 | Error crudo del SDK logueado | Media | Un error de `fetchPaymentState` llega a `console.error(err)` (`src/app.ts:84`) con headers del request: el `Authorization: Bearer` del carrier queda en el proveedor de logs; quien lo lea puede operar (reembolsar) sobre la cuenta MP del fletero. | sí (fix trivial) | Envolver en el traductor de errores de `lib/mercadopago.ts`; el handler genérico loguea solo `name`/`code`. |
| 8 | Geocode/OSRM dentro de la TX Serializable | Media | `GET /trips/geocode` y `/price-estimate` son públicos y sin límite y alimentan la misma cola de 1 req/s: un script los inunda y toda reserva (`addCargoItem`) excede los 10 s de la TX → DoS del marketplace. Además Nominatim puede banear la IP del server. | no | Geocodificar antes de abrir la TX; rate limit en los endpoints públicos de geocode. |
| 9 | Ventana de cancelación contra medianoche UTC | Media | No es explotable, pero cobra de más: un viaje a las 18 h ART se mide ~21 h antes; una cancelación a 60 h reales paga 50 %. Reclamo/contracargo seguro. | no | Componer `date` + `departureTime` en `America/Argentina/Buenos_Aires`. |
| 10 | Seña atrapada al pasar a IN_TRANSIT | Alta | Fraude del fletero: cobra señas (van a **su** cuenta MP), nunca confirma y pone el viaje en tránsito → las cargas PENDING no se pueden retirar ni reembolsar. La empresa pierde la seña sin servicio. | sí | Al salir: auto-cancelar con reembolso total las PENDING (o auto-confirmar las que tienen seña APPROVED). |
| 11 | Outbox sin worker / PROCESSING sin CAS | Media | Un reembolso que falla una vez (y con #6 fallan todos) queda PENDING para siempre; dos procesos pueden reembolsar dos veces la misma request si MP no deduplica. | no* | Job periódico con `updateMany where status=PENDING` como CAS + timeout para PROCESSING. *Bloquea si #6 no se arregla. |
| 12 | FULL→OPEN fuera de TX | Baja | Estado inconsistente (viaje FULL que acepta cargas o OPEN lleno); sin sobreventa. | no | Mover el recálculo dentro de una TX o derivarlo al leer. |
| 13 | priceShare inline | Baja | Sin impacto de seguridad; riesgo de divergencia de precios si cambia `lib/pricing.ts`. | no | Usar la función de `lib/pricing.ts`. |
| 14 | `getTripLocation` devuelve la primera posición | Baja | Funcional (la empresa ve una ubicación vieja). | no | `orderBy` descendente en `findFirst`. |
| 15 | Participantes con cargas CANCELLED | Alta | Un competidor o banda reserva una carga, la cancela gratis (>48 h) y conserva para siempre el GPS en vivo del camión y todo el chat del viaje. En Argentina eso es inteligencia para robo en ruta. | sí | `resolveParticipants` filtra con `isActiveCargo`. |
| 16 | `trackingCode` predecible + endpoint público | Media | `TP-{últimos 4 del tripId}-C{n}`: los tripIds son públicos, así que los códigos se derivan sin fuerza bruta (y `GET /trips/:id/route` ya los publica). Expone descripción, estado, tramo y fecha de cada carga. | no | Código aleatorio de ≥ 80 bits + rate limit; no publicarlo en `/route`. |
| 17 | OAuth MP sin refresh + `state` reutilizable 10 min | Media | Funcional: el token vence (~180 días) y el fletero deja de cobrar sin aviso. Seguridad: si se filtra un `state` (historial/referrer), un atacante lo completa con **su** `code` y los cobros de ese fletero van a la cuenta del atacante. | no | Guardar `refresh_token` cifrado; `state` con nonce de un solo uso persistido. |
| 18 | CLAUDE.md desactualizado | Info | — | no | Actualizar el doc. |

## Parte 2 — Auditoría nueva

### 2.1 IDOR: rutas × auth × rol × ownership

**auth** (`modules/auth/auth.routes.ts`)
| Ruta | Auth | Rol | Ownership |
|---|---|---|---|
| POST /auth/register | no (rate limit) | — | n/a (rol limitado a COMPANY/CARRIER en schema) |
| POST /auth/login | no (rate limit) | — | n/a |
| GET /auth/me | sí | — | OK (self) |
| POST /auth/logout | sí | — | OK |

**trips** (`modules/trips/trips.routes.ts`)
| Ruta | Auth | Rol | Ownership |
|---|---|---|---|
| GET /trips | no | — | n/a (listado) |
| GET /trips/geocode | no | — | n/a — **sin rate limit, proxy a Nominatim** |
| GET /trips/price-estimate | no | — | n/a — idem |
| GET /trips/cancellation-quote | no | — | n/a (cálculo puro) |
| GET /trips/:id/manifest.pdf | sí | — | OK (carrier o carga activa, `trips.service.ts:1470`) |
| GET /trips/:id/location | sí | — | **FALTA** (incluye cargas CANCELLED, `:1290`) |
| POST /trips/:id/location | sí | CARRIER | OK (`:1540`) |
| GET /trips/:id | **no** | — | **FALTA** (todas las cargas, pickups, pagos) |
| POST /trips | sí | CARRIER | OK (VERIFIED + MP, `:397`) |
| POST /trips/:id/cargo-items | sí | COMPANY | n/a — **sin límite de reservas PENDING por empresa** |
| PATCH /trips/:id/status | sí | CARRIER | OK (`:493`) |
| DELETE /trips/:tripId/cargo-items/:cargoItemId | sí | COMPANY | OK (`:791`) |
| PATCH /trips/:tripId/cargo-items/:cargoItemId | sí | (ninguno) | OK (carrier o empresa dueña, `:692`). Ojo: la empresa puede confirmar su propia carga; validar si es intencional. |
| GET /trips/:id/messages | sí | — | **FALTA**: devuelve todos los mensajes del viaje, también los de carrier↔otra empresa (`:1349-1356`) + ex-participantes |
| POST /trips/:id/messages | sí | — | **FALTA parcial**: ex-participantes escriben; una empresa puede escribirle a otra |
| PATCH /trips/:id/messages/read | sí | — | OK (solo `toUserId`) |
| POST /trips/:id/reviews | sí | COMPANY | OK |
| GET /trips/:id/stops | sí | — | **FALTA**: cualquier empresa con carga ve dirección/coords/trackingCode de las demás; ex-participantes también |
| PATCH /trips/:id/stops/reorder | sí | CARRIER | OK (`:1690`); sin `validateBody` (valida a mano, `order` sin tipo) |
| GET /trips/:id/route | **no** | — | **FALTA**: pickups exactos, descripción, trackingCode de cada carga + `departureLat/Lng` (`:1766-1790`) |
| GET /trips/:id/route-geometry | **no** | — | **FALTA** (deriva los mismos puntos) + amplificación OSRM sin límite |
| GET /trips/tracking/:code y GET /tracking/:code | no | — | n/a — sin rate limit |

**users / carriers / admin** (`modules/users/users.routes.ts`)
| Ruta | Auth | Rol | Ownership |
|---|---|---|---|
| GET/PATCH /users/me | sí | — | OK (self; zod descarta campos extra) |
| PATCH /users/me/availability | sí | CARRIER | OK |
| GET /users/me/mp-connect | sí | CARRIER | OK |
| GET /users/me/mp-callback | no (state firmado) | — | OK con reservas (Parte 1 #17) |
| GET /users/me/trips | sí | CARRIER | OK |
| GET /users/me/cargo-items | sí | COMPANY | OK |
| PATCH /users/me/verification | sí | CARRIER | OK |
| POST /users/trip-requests | sí | COMPANY | OK — sin rate limit (dispara email) |
| GET /users/trip-requests/received | sí | CARRIER | OK |
| GET /users/trip-requests/sent | sí | COMPANY | OK |
| PATCH /users/trip-requests/:id/respond | sí | CARRIER | OK ownership; **FALTA chequeo VERIFIED** (ver 2.2) |
| GET /carriers | no | — | OK |
| GET /carriers/:id | no | — | **expone `phone`** sin sesión (`users.service.ts:201`) |
| GET /admin/stats | sí | ADMIN | OK |
| GET /admin/verifications | sí | ADMIN | OK |
| PATCH /admin/verifications/:userId | sí | ADMIN | OK |

**notifications** — las 3 rutas con `requireAuth`; `markNotificationRead` usa `updateMany where {id, userId}` (no-op ajeno): OK.

**payments** (`modules/payments/payments.routes.ts`)
| Ruta | Auth | Rol | Ownership |
|---|---|---|---|
| POST /payments/webhook | HMAC | — | ver Parte 1 #3 |
| POST /cargo-items/:id/payment-preference | sí | COMPANY | OK (`payments.service.ts:101`) |
| GET /payments/mp/:id | sí | — | OK (empresa, carrier o ADMIN; sin pago local solo ADMIN) |
| GET /payments/mp/test | sí | ADMIN | inalcanzable (Parte 1 #2) |
| POST /payments/mp/test-preference | sí | ADMIN | OK, pero crea preferences reales con el token de plataforma: sacar de prod |

### 2.2 Verificación de identidad del fletero
- **No hay documentos**: no existe upload ni almacenamiento de archivos. `PATCH /users/me/verification` recibe solo `taxId` (string 1–32, sin validar formato ni dígito verificador de CUIT, `users.schemas.ts`). No hay riesgos de tipo/tamaño/URL adivinable porque no hay archivos, pero el admin aprueba a ciegas: la verificación no prueba identidad.
- **Bypass de la verificación (Alta)**: `respondTripRequest` al aceptar crea un `Trip` exigiendo solo `mpUserId` (`users.service.ts:563-586`), no `VERIFIED`. Un fletero no verificado (o rechazado) publica viajes y cobra señas: rompe la única barrera antifraude.
- `listPendingVerifications` informa `requestedAt = createdAt` del usuario, no la fecha del pedido (Baja).
- Rol tomado del JWT sin consultar la base: degradar o borrar un usuario no corta su sesión hasta 7 días (Baja).

### 2.3 Endpoints admin
Ninguno es accesible sin `ADMIN`: las tres rutas de `/admin` y los diagnósticos de pagos llevan `requireAuth` + `requireRole("ADMIN")`. `register` no permite ADMIN.
**Pero (Crítica)**: los admins solo salen del seed, y `prisma/seed.ts:6,23-31` crea `admin@truckpool.app` con la contraseña hardcodeada `truckpool123` (publicada en README/CLAUDE.md), sin guardia de `NODE_ENV`. Correr el seed en prod = admin con credenciales públicas → aprueba fleteros falsos y ve CUIT/emails de todos.

### 2.4 XSS
- **Cliente: sin sinks**. No hay `dangerouslySetInnerHTML`/`innerHTML`; los `L.divIcon({html})` (`TripRouteMap.tsx:28`, `TripPinMap.tsx:28`, `TripMap.tsx:18`) interpolan solo colores constantes y números; no hay `href` con datos de usuario; los `window.location.href` usan URLs que devuelve el server (MP). Mensajes, reviews, direcciones y bios se renderizan como texto React (escapado).
- **Emails: HTML injection (Media)**. `renderEmail` (`lib/email.ts:93-98`) interpola sin escapar `name`, `description`, `origin`, notas de trip-request. Una empresa registrada como `<a href="https://phish…">verificá tu cuenta MP</a>` manda phishing con remitente truckpool a fleteros. No ejecuta JS en clientes de mail, pero sí links/imágenes.
- **Impacto si aparece un XSS**: el JWT vive en `localStorage` (7 días, sin refresh ni httpOnly) → cualquier XSS futuro = robo de sesión completo, incluido admin. La CSP del cliente "se define en el hosting" (`lib/security.ts:21`) y no está en el repo: hoy no hay CSP efectiva para la SPA.

### 2.5 Rate limiting faltante
Solo existen `loginRateLimit`/`registerRateLimit` (`lib/rateLimit.ts`), por IP. Sin límite:
| Endpoint | Abuso |
|---|---|
| POST /trips/:id/cargo-items | una empresa reserva toda la capacidad de todos los viajes sin pagar (hold 24 h, se repite): DoS comercial de la competencia |
| POST /cargo-items/:id/payment-preference | spam de preferences en la cuenta MP del fletero |
| POST /trips/:id/messages | spam + notificación por mensaje |
| POST /users/trip-requests | email bombing a fleteros (con HTML injection) |
| GET /tracking/:code, /trips/tracking/:code | enumeración (códigos derivables) |
| GET /trips/geocode, /price-estimate | agota la cola de Nominatim → bloquea reservas (Parte 1 #8) |
| GET /trips/:id/route-geometry | amplificación hacia OSRM |
| POST /payments/webhook | barato de verificar; bajo riesgo |
| Login | por IP solamente: credential stuffing distribuido no se frena; `skipSuccessful` deja probar cuentas válidas |

### 2.6 Secretos y configuración
- **CORS fail-open (Media)**: en producción sin `CORS_ORIGIN`, `cors()` queda con `origin: *` (`src/app.ts:39-42`). Con Bearer en header no filtra sesión por sí solo, pero cualquier sitio puede usar la API desde el navegador de la víctima si obtiene el token. Debe abortar el arranque.
- **`assertServerEnv` incompleto** (`lib/env.ts:35-56`): no valida en prod `TOKEN_ENCRYPTION_KEY`, `MP_WEBHOOK_SECRET`, `CORS_ORIGIN`, `APP_URL`, `API_PUBLIC_URL`. Fallan perezosamente.
- **`APP_URL` default `http://localhost:5173`** en links de email (`lib/email.ts` `tripUrl`) y redirect de OAuth (`users.controller.ts` `getMpCallback`).
- **Helmet**: correcto para una API JSON (CSP `default-src 'none'`, HSTS en prod, frameguard). Falta la CSP del cliente (2.4).
- **`trust proxy` = 1 por defecto en prod** (`lib/security.ts:73`): si no hay proxy delante, `X-Forwarded-For` es del cliente → bypass del rate limit de login.
- **Logs**: `src/app.ts:84` loguea errores crudos (SDK MP, Prisma con parámetros); `trips.service.ts:85` idem; `lib/email.ts:33,49,55` loguea emails de destinatarios y el body de error de Resend (PII); `lib/auth.ts:94` loguea cada token inválido (ruido, sin secreto).
- **Seed** con credenciales públicas (2.3). Registro enumera emails (`EMAIL_TAKEN` 409, Baja).

### 2.7 Mensajes y ubicación: quién puede qué
| Recurso | Leer | Escribir | Problema |
|---|---|---|---|
| Mensajes | carrier + **toda** empresa que alguna vez tuvo carga (incl. CANCELLED) — ve **todos** los mensajes del viaje | mismos; destino: cualquier participante (empresa→empresa incluido) | sin aislamiento por conversación; ex-participantes |
| Marcar leídos | mismos | solo los propios (`toUserId`) | OK |
| Ubicación (GPS) | carrier + toda empresa con carga, incl. CANCELLED; historial completo con `?history=true` | solo carrier del viaje, solo IN_TRANSIT | ex-participantes ven el camión en vivo |
| Paradas | mismos que ubicación; ven pickups de las otras empresas | reordenar: solo carrier | fuga horizontal entre empresas |
| Ruta/geom. | **cualquiera, sin sesión** | — | pickups exactos públicos |
| Tracking público | cualquiera con el código (derivable) | — | Parte 1 #16 |

## TOP 10 (por severidad)
| # | Sev. | Archivo:línea | Riesgo | Fix |
|---|---|---|---|---|
| 1 | Crítica | `prisma/seed.ts:6` (admin `:23-31`) | El único camino a un ADMIN en prod deja `admin@truckpool.app / truckpool123`, contraseña pública | Seed demo bloqueado con `NODE_ENV=production`; admin de prod por script con contraseña de env/CLI |
| 2 | Alta | `modules/users/users.service.ts:571-586` | Fletero no verificado publica viajes aceptando una trip-request y cobra señas | Mismo chequeo `VERIFIED` que `createTrip` (`trips.service.ts:397`) |
| 3 | Alta | `modules/payments/payments.controller.ts:51-61` + `lib/mercadopago.ts:566` | Una notificación firmada reutilizable para aprobar cualquier pago (status y lookup sin firmar, sin frescura) | Solo `data.id` firmado → estado consultado a MP; ventana de `ts` |
| 4 | Alta | `modules/payments/payments.service.ts:248-249` | Reembolso del 100 % tras la penalidad parcial; el fletero pierde la penalidad siempre | Saltar si ya hubo reembolso; monto según política |
| 5 | Alta | `lib/mercadopago.ts:314,510,533` | Token de plataforma sobre pagos del carrier: nada se acredita y ningún reembolso sale | Token descifrado del carrier |
| 6 | Alta | `lib/mappers.ts:94-113` + `modules/trips/trips.service.ts:1766-1790` | `GET /trips/:id` y `/route` anónimos exponen pickups exactos, mercadería, pagos y trackingCodes | DTO público whitelist; detalle solo a participantes activos |
| 7 | Alta | `modules/trips/trips.service.ts:1290-1300` y `:1349-1356` | Ex-participantes (cancelación gratis) mantienen GPS en vivo y chat; cada empresa lee los mensajes de las otras | Filtrar `isActiveCargo`; mensajes `where` incluye `fromUserId/toUserId = userId` salvo carrier |
| 8 | Alta | `modules/trips/trips.service.ts:524` | El fletero cobra señas, no confirma, sale: la empresa pierde la seña sin vía de reembolso | Al pasar a IN_TRANSIT, cancelar+reembolsar las PENDING |
| 9 | Alta | `modules/trips/trips.routes.ts:61-67` (+ `lib/rateLimit.ts`) | Reservas ilimitadas sin pagar bloquean la capacidad de todo el marketplace; endpoints sensibles sin rate limit | Tope de reservas PENDING por empresa + `express-rate-limit` por usuario en reserva/pagos/mensajes/tracking/geocode |
| 10 | Media | `lib/email.ts:93-98` | HTML injection en emails (phishing con remitente truckpool) | Escapar todo input interpolado en `renderEmail` |

**También bloquean, fuera del TOP 10:** logueo crudo de errores del SDK (`src/app.ts:84`, Parte 1 #7) y CORS fail-open en prod (`src/app.ts:39-42`).
