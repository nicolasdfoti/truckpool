# 04 — Plan de lanzamiento (Fase D)
Sintetiza `01-arquitectura.md`, `02-seguridad-pagos.md` y `03-diseno.md`. Rutas relativas a
`server/` salvo `client/…`. Solo se miró código para confirmar nombres de env vars y el e2e.

**Referencias**: `01§2` sección · `02#3` fila 3 de la Parte 1 de 02 · `02T3` TOP 10 #3 ·
`03/Publicar#1` §2, pantalla, ítem · `QW6` quick win #6 de 03§5 · `U4` hallazgo unificado (§1) ·
`D3` decisión de producto (§6) · `R1` tarea de repo (§5).
**Prioridad**: BLOQUEANTE = no se cobra plata real sin esto · 1ª SEMANA = se lanza con esto
abierto y se cierra en 7 días · DESPUÉS. **Esfuerzo**: S ≤ ½ día · M 1–2 días · L 3–5 días.

## 0. Resumen
| Lote | Área | Prioridad | Esf. | Depende de |
|---|---|---|---|---|
| L1 | Webhook y estados de pago | BLOQUEANTE | L | — |
| L2 | Exposición de datos (server) | BLOQUEANTE | L | — |
| L3 | Vista por rol en el cliente | BLOQUEANTE | M | L2, R1 |
| L4 | Ciclo de vida de cargas | BLOQUEANTE | L | L1, D3, D4 |
| L5 | Hardening | BLOQUEANTE | M | — |
| L6 | Geocoding y precio | BLOQUEANTE | M | D5 |
| L7 | UX de pagos | BLOQUEANTE | M | L1, L2, L4, D1, R1 |
| L8 | Quick wins | 1ª SEMANA | S | L3 |
| L9 | Cuentas y verificación | 1ª SEMANA | M | L1, L4 (scheduler) |
| L10 | Diseño | DESPUÉS | L | L3, L7 |
| L11 | Deuda técnica | DESPUÉS | M | L1–L4 |

**Ajustes a la propuesta original**: la UI de 03§1.5 sale de L2 a un L3 propio (L2 cambia el
contrato, L3 lo consume; juntos no entran en una sesión) · el tope de reservas PENDING va a L4
(vive en `addCargoItem`) · la línea de tiempo de pago pasa a L10: L7 cubre solo lo que engaña o
hace perder plata · QW1/4/9/12 se absorben en L7 y QW6/14/17 en L3 · los diagnósticos de pagos
van a L1 (mismo router) · lotes nuevos L9 (OAuth MP, CUIT, recuperar contraseña) y L11.

## 1. Hallazgos unificados (los que aparecen en más de un informe)
| ID | Hallazgo | Orígenes | Lote |
|---|---|---|---|
| U1 | Seña atrapada al pasar a IN_TRANSIT | 01§2, 02#10, 02T8, 03§1.4, 03/Confirmar#1, QW9 | L4, L7 |
| U2 | Webhook: status y query sin firmar, sin frescura de `ts` | 01§2, 01§4, 02#3, 02T3 | L1 |
| U3 | Estados de pago sin guardia | 01§2, 01§4, 02#4 | L1 |
| U4 | Penalidad 24–48 h se pierde (refund 100 %) | 01§2, 01§4, 02#5, 02T4 | L1 |
| U5 | Token de plataforma sobre pagos del carrier | 01§2, 01§4, 02#6, 02T5, 03§1.1, 03§1.3 | L1 |
| U6 | Error crudo del SDK / PII en logs | 01§2, 02#7, 02§2.6 | L1, L5 |
| U7 | Mapper por omisión; detalle y `/route` públicos | 01§2, 01§4, 02#1, 02T6, 02§2.7, 03§1.5, 03/Detalle#1 | L2, L3 |
| U8 | Ex-participantes y chat sin aislamiento | 01§2, 02#15, 02T7, 02§2.1, 02§2.7 | L2 |
| U9 | `trackingCode` predecible y publicado | 01§2, 02#16, 02§2.5, 03§1.5, 03/Rastrear#3, QW14 | L2, L3 |
| U10 | Geocode/OSRM dentro de la TX | 01§2, 02#8, 02§2.5 | L6, L5 |
| U11 | Ventana de cancelación contra medianoche UTC | 01§2, 02#9 | L4 |
| U12 | Outbox de reembolsos sin worker | 01§2, 01§4, 02#11 | L4 |
| U13 | Trip-requests saltean VERIFIED | 02§2.2, 02T2, 03/Solicitudes#3 | L5 |
| U14 | Seed con admin de contraseña pública | 02§2.3, 02§2.6, 02T1 | L5, R4 |
| U15 | Rate limits faltantes / reservas ilimitadas | 01§2, 02§2.5, 02T9 | L5, L4 |
| U16 | `/pagos/retorno` solo lee `?status` | 01§1.4, 03§1.1, 03/Retorno#1-2, QW4 | L7 |
| U17 | La empresa confirma su propia carga | 02§2.1, 03§1.1, 03§1.4 | D1, L7 |
| U18 | Verificación sin prueba de identidad | 02§2.2, 03/Admin#1,#4 | L9 |
| U19 | Paradas: fuga entre empresas + 403 reintentado | 02§2.1, 02§2.7, 03§1.5, 03/Detalle#2, QW6 | L2, L3 |
| U20 | Diagnósticos de pagos en prod / orden de rutas | 01§2, 01§3, 02#2, 02§2.1 | L1 |
| U21 | Quote de retiro ignora si la seña se pagó; `confirm` nativo | 03§1.2, QW1 | L4, L7 |
| U22 | CLAUDE.md desactualizado | 01§2, 02#18 | ya resuelto; queda README (R3) |

## 2. Lotes

### L1 — Webhook y estados de pago · BLOQUEANTE · L
Archivos: `modules/payments/payments.{controller,service,routes}.ts`, `lib/mercadopago.ts`,
`src/app.ts`. Tests: `tests/payments.service.test.ts`, `tests/app.test.ts`, nuevo `tests/mercadopago.test.ts`.
- [x] Ignorar `data.status` y `?payment_id`/`?preference_id`; buscar solo por el `data.id` firmado y pedir el estado a MP — U2 — `payments.controller.ts:51-61`, `payments.service.ts:228-318` — test: firma válida + `status=approved` falso no aprueba; query manipulada se ignora.
- [x] Rechazar `ts` fuera de ±5 min — U2 — `lib/mercadopago.ts:544-566` — test: `ts` viejo → 401; actual → 200.
- [x] Máquina de estados (`PENDING→APPROVED|REJECTED`, `APPROVED→REFUNDED`; conservar el CAS de reintento de la preferencia); el resto se ignora y se loguea — U3 — `payments.service.ts:257-260` — test: APPROVED→REJECTED y REFUNDED→APPROVED no cambian nada.
- [x] Rama CANCELLED: no reembolsar si ya hay `RefundRequest`/`refundedAmount`; monto según la política congelada — U4 — `payments.service.ts:248-249` — test: retiro a 30 h + `payment.updated` repetido ×3 → total reembolsado = 50 %.
- [x] `fetchPaymentState`, `refundPayment`, `refundedAmount` con el token descifrado del carrier del pago (mismo resolver que `createCheckoutPreference`) — U5 — `lib/mercadopago.ts:25,314,510,533` — test: webhook **sin** `data.status` consulta con el token del carrier.
- [x] Traducir errores de `fetchPaymentState` a `MP_ERROR`/`MP_INVALID_RESPONSE`; el handler genérico loguea solo `name`/`code` — U6 — `lib/mercadopago.ts:311`, `src/app.ts:84` — test: un error con `Authorization` no llega al log (spy de `console.error`).
- [x] Diagnósticos (`/payments/mp/:id`, `/mp/test`, `/mp/test-preference`) montados solo fuera de prod; si quedan, `/mp/test` antes de `/:id` — U20 — `payments.routes.ts:34-56` — test: con `NODE_ENV=production` → 404.

### L2 — Exposición de datos (server) · BLOQUEANTE · L
Archivos: `lib/mappers.ts`, `modules/trips/trips.{service,routes}.ts`, `modules/users/users.service.ts`,
migración Prisma (tracking). Tests: `tests/trips.service.test.ts`, `tests/app.test.ts`.
- [ ] DTO por whitelist: anónimos y no participantes ven solo agregados (m³ ocupados, cantidad de cargas); la empresa participante ve su carga completa y las ajenas como `{volume, pickupCity}`; el carrier todo — U7 — `lib/mappers.ts:66,94-113`, `getTripById` — test: snapshot de claves de `GET /trips/:id` como anónimo, otra empresa, dueña y carrier.
- [ ] `/trips/:id/route` y `/route-geometry` con auth + participante activo; a terceros solo ciudades — U7 — `trips.service.ts:1766-1790` — test: anónimo 401, ex-participante 403.
- [ ] `resolveParticipants` filtra `isActiveCargo` — U8 — `trips.service.ts:1290-1300` — test: empresa con carga CANCELLED → 403 en location, messages y stops.
- [ ] Mensajes por conversación: la empresa lee/escribe solo con el carrier; empresa→empresa prohibido — U8 — `trips.service.ts:1349-1356` — test: A no lee carrier↔B; POST a otra empresa → 403.
- [ ] Paradas: cada empresa ve la suya completa y las ajenas como "otra parada · ciudad" — U19 — `getTripStops` — test: A no recibe address/coords/trackingCode de B.
- [ ] `trackingCode` aleatorio ≥ 80 bits (`TP-` + base32), migración de los existentes, fuera de `/route` — U9 — `trips.service.ts:930` — tests: formato/unicidad; `/route` no lo trae; `/api/tracking/:code` válido e inválido (hoy 0 tests).
- [ ] `GET /carriers/:id` sin `phone` para anónimos — 02§2.1 — `users.service.ts:201` — test: anónimo no recibe `phone`.
- [ ] `getTripLocation` sin historial devuelve la última posición — 01§2, 02#14 — `trips.service.ts:1514,1581` — test: el mock verifica `orderBy: desc`.

### L3 — Vista por rol en el cliente · BLOQUEANTE · M
Archivos: `pages/TripDetail.tsx`, `components/CargoFillDiagram.tsx`, `components/TripStops.tsx`,
`hooks/useTripStops.ts`, `hooks/useAddCargoItem.ts`, `pages/TrackPackage.tsx`, tipos de `src/api`.
Tests: e2e nuevo `tests-e2e/trip-detail-roles.spec.ts` (anónimo / otra empresa / dueña / fletero).
- [ ] Terceros: barra de ocupación sin nombres + "Ya hay 2 cargas en este viaje (7 m³). Quedan 23 m³ libres."; ajenas como "Otra carga · 3 m³ · retiro en Rosario" — U7, 03§1.5 — `TripDetail.tsx:515-600`.
- [ ] Paradas: ocultas a no participantes, `retry: false` en 401/403/404, invalidar `stops` al reservar — U19 — `TripStops.tsx:111,175`.
- [ ] `/rastrear`: `retry: false` en 404, botón vuelve a "buscar", error sin el formato del código — U9, 03/Rastrear#1-3.
- [ ] El fletero dueño no ve "sumar carga a este viaje" — 03/Confirmar#4, QW17.
- [ ] e2e: el anónimo no ve descripción, dirección, monto ni código ajenos; tracking inexistente responde en < 2 s.

### L4 — Ciclo de vida de cargas · BLOQUEANTE · L
Archivos: `trips.service.ts` (`updateTripStatus`, `addCargoItem`, `cancelCargoItem`,
`releaseExpiredReservations`, `processRefundRequest`), `lib/cancellation.ts`, `lib/pricing.ts`,
nuevo `lib/jobs.ts` + arranque en `src/index.ts`. Tests: `tests/trips.service.test.ts`, nuevo `tests/jobs.test.ts`.
- [ ] Al pasar a IN_TRANSIT, cancelar todas las PENDING en la misma TX (D3 = a): con seña APPROVED se encola `RefundRequest` por el 100 %, sin seña se cancelan sin reembolso — U1 — `trips.service.ts:471-534` — test: 1 CONFIRMED + 1 PENDING con seña + 1 sin seña → BALANCE solo para la confirmada, reembolso 100 % para la segunda, ninguna queda PENDING.
- [ ] CONFIRMED retirable hasta la salida con la misma penalidad que una PENDING (D4 = b) — 01§2 — `trips.service.ts:797` — test por tramo de la política (> 48 h, 24–48 h, < 24 h) y 409 una vez IN_TRANSIT.
- [ ] Estado de viaje `CANCELLED` (D6 = a+b): el fletero cancela un viaje OPEN/FULL y el scheduler cancela los que no pasaron a IN_TRANSIT 24 h después de la salida; en ambos casos las cargas activas se cancelan con reembolso 100 % de la seña vía `RefundRequest` — D6 — schema Prisma (enum de estado del viaje + migración), `updateTripStatus`, `lib/jobs.ts`, `lib/mappers.ts` — tests: cancelación manual y automática reembolsan 100 % a cada empresa; no se cancela en IN_TRANSIT/COMPLETED; un viaje CANCELLED no acepta cargas.
- [ ] Reordenar paradas en IN_TRANSIT notifica a las empresas cuyo orden cambió (D2 = b) — 03/Paradas#4 — `trips.service.ts` (reorden de paradas), notificaciones — test: solo las empresas afectadas reciben la notificación.
- [ ] Worker del outbox cada 1 min: CAS con `updateMany where status=PENDING`, timeout de PROCESSING (10 min), backoff y tope → FAILED + alerta — U12 — `trips.service.ts:912,2019-2026` — tests: dos workers no toman la misma; PROCESSING viejo se retoma; tope → FAILED.
- [ ] El mismo scheduler corre `releaseExpiredReservations` (hoy perezoso, 01§1.3) y el FULL→OPEN entra en TX — 01§2, 02#12 — `trips.service.ts:223-289` — test: vence sin lecturas; estado consistente con un `addCargoItem` concurrente.
- [ ] Ventana de retiro con `date` + `departureTime` en `America/Argentina/Buenos_Aires` — U11 — `lib/cancellation.ts:16`, `trips.service.ts:817` — tests: salida 18:00 ART, retiro a 60 h reales → 100 %; bordes exactos de 48 h y 24 h.
- [ ] Quote por carga autenticado que devuelve $ 0 si la seña no está APPROVED — U21 — nueva ruta `…/cargo-items/:id/cancellation-quote` (antes de `/:id`) — test: seña PENDING → 0.
- [ ] Cotización de una carga por volumen desde el server (precio, seña, saldo) para el resumen de L7 — 03§1.3 — reusar `lib/pricing.ts` — test: igual a lo que cobra `addCargoItem`.
- [ ] No listar ni reservar viajes de fleteros sin MP (`MP_ACCOUNT_NOT_CONNECTED` al reservar) — 03/Pagar seña#1 — `listOpenTrips`, `addCargoItem` — test: 409 con código estable.
- [ ] Tope de reservas PENDING sin seña por empresa (sugerido 3 en total, 1 por viaje) dentro de la TX — U15 — test: la 4.ª → 409 `TOO_MANY_PENDING`.
- [ ] `priceShare` desde `lib/pricing.ts` — 01§2, 02#13 — `trips.service.ts:1062` — test: mismo valor que `pricing`.
- [ ] Contracargos (`charged_back`): estado propio del pago (`CHARGED_BACK`, migración) + alerta al admin; hoy mapea a REJECTED y, tras L1, APPROVED→REJECTED queda bloqueado y solo se loguea — U3 (fuera de L1) — `lib/mercadopago.ts` `STATUS_BY_MP_STATE`, `payments.service.ts` (`ALLOWED_TRANSITIONS`) — test: APPROVED + `charged_back` → `CHARGED_BACK` y alerta.

### L5 — Hardening · BLOQUEANTE · M
Archivos: `prisma/seed.ts`, nuevo `prisma/create-admin.ts`, `users.service.ts`, `lib/{rateLimit,env,security,email}.ts`,
`src/app.ts`, `trips.{routes,schemas}.ts`. Tests: `tests/app.test.ts`, nuevos `tests/env.test.ts`, `tests/email.test.ts`.
- [ ] Seed demo aborta con `NODE_ENV=production`; admin de prod con `npm run admin:create` (email/clave por env o prompt, ≥ 16 chars) — U14 — `prisma/seed.ts:6,23-31` — test: seed en prod lanza.
- [ ] `respondTripRequest` exige VERIFIED (reusar el chequeo de `createTrip :397`) y rechaza solicitudes con fecha pasada — U13, 03/Solicitudes#1 — `users.service.ts:563-586` — test: no verificado → 403 con el código de `createTrip`.
- [ ] Rate limits: por usuario en reserva, payment-preference, mensajes, trip-requests; por IP en tracking, geocode, price-estimate, route-geometry — U15 — `lib/rateLimit.ts`, routers — test: N+1 → 429 con `code`.
- [ ] Login limitado también por email (credential stuffing) — 02§2.5 — test: muchas IPs, mismo email → 429.
- [ ] `assertServerEnv` en prod exige `TOKEN_ENCRYPTION_KEY`, `MP_WEBHOOK_SECRET`, `CORS_ORIGIN`, `APP_URL`, `API_PUBLIC_URL` (https, no localhost) y `TRUST_PROXY` explícito — 02§2.6 — `lib/env.ts:35-56`, `src/app.ts:39-42`, `lib/security.ts:73` — test: cada faltante aborta.
- [ ] Escapar todo lo interpolado en `renderEmail` — 02§2.4, 02T10 — `lib/email.ts:93-98` — test: nombre `<a href=…>` sale escapado.
- [ ] Logs sin PII (destinatarios y body de Resend, parámetros de Prisma) — U6 — `lib/email.ts:33,49,55`, `trips.service.ts:85` — test: spy del logger.
- [ ] `validateBody` Zod en `PATCH /stops/reorder` — 02§2.1 — test: `order` inválido → 400.

### L6 — Geocoding y precio · BLOQUEANTE · M
Archivos: cliente de Nominatim en `lib/`, `trips.service.ts` (`createTrip`, `addCargoItem`), `client/src/pages/PublishTrip.tsx`.
Tests: `tests/trips.service.test.ts` + test del geocoder (existente o nuevo).
- [ ] `countrycodes=ar` en Nominatim — 03/Publicar#1, 03/Sin coords#2 — test: la URL lleva el parámetro.
- [ ] Geocode y OSRM antes de abrir la TX de `addCargoItem` — U10 — `trips.service.ts:1075,1079,1150` — test: geocode lento no hace fallar la reserva; la TX no llama al geocoder.
- [ ] Distancia > 5.000 km → sin sugerencia; el ±15 % pasa a ser solo un aviso y el server deja de rechazar precios fuera de rango (D5 = b) — 03/Publicar#1 — `createTrip :420` — tests: precio fuera de ±15 % → 201; > 5.000 km → sin sugerencia.
- [ ] Precio siempre editable con la sugerencia como referencia; fuera de ±15 % un aviso que no bloquea ("está 40 % arriba del sugerido"); lugar resuelto en texto con país ("Córdoba, Andalucía, **España** — ¿es correcto?") — 03/Publicar#1,#4 — `PublishTrip.tsx:108-140`.
- [ ] Re-geocodificar los viajes existentes fuera de Argentina (`npm run seed:geocode` con filtro).

### L7 — UX de pagos · BLOQUEANTE · M
Archivos: `pages/PaymentReturn.tsx`, `pages/TripDetail.tsx`, nuevo `components/ConfirmDialog.tsx`, hooks de pago/cargas.
Tests: e2e `tests-e2e/payment-return.spec.ts` y `tests-e2e/cargo-lifecycle.spec.ts` (red interceptada).
- [ ] `/pagos/retorno` con `cargoItemId`/`type` del back_url: polling cada 3 s hasta 60 s del estado real y copy de la tabla de 03§1.1 — U16 — `PaymentReturn.tsx`.
- [ ] Diálogo propio de retiro con desglose (seña sin pagar / pagada / retenido / plazo MP) usando el quote de L4, también para cargas CONFIRMED hasta la salida (D4 = b) — U21 — `TripDetail.tsx:78-98`.
- [ ] Diálogo "¿Salís ahora?" + checklist "Antes de salir": ofrece confirmar las que tienen seña y avisa que las PENDING que queden se cancelan con reembolso 100 % de la seña (D3 = a) — U1, 03§1.4 — `TripDetail.tsx:464-480`.
- [ ] "Cancelar viaje" para el fletero (OPEN/FULL) con diálogo "Se devuelve el 100 % de la seña a N empresas" y badge del estado CANCELLED (D6 = a+b) — D6 — `TripDetail.tsx`.
- [ ] "Reservado hasta {createdAt + 24 h}" en la fila PENDING (danger < 3 h) y política de retiro antes de reservar — 03§1.2, QW12.
- [ ] Resumen en vivo antes de "sumar carga" con la cotización del server (nunca calcular en el cliente); saldo pendiente visible después de la seña — 03§1.3, 03/Detalle#3.
- [ ] Error de pago dentro de la fila con botón deshabilitado y motivo; "retirar carga" como `outline` danger — 03/Pagar seña#2-3.
- [ ] "Confirmar carga" solo para el fletero (D1 = a): `TripDetail.tsx:242-244` y `trips.service.ts:692` (la empresa recibe 403, test en `tests/trips.service.test.ts`); aviso al fletero cuando se acredita la seña; "Esperando la seña de la empresa (vence …)" — U17, 03§1.4.

### L8 — Quick wins · 1ª SEMANA · S
Los de 03§5 no absorbidos. Validación: `npm run lint && npm run build` + e2e. Conviene meterlo antes del lanzamiento si sobra medio día.
- [ ] QW2 copy del diagrama · QW3 login (`autocomplete`, sin mínimo en "acceder") · QW5 landing sin "MVP… Próximamente: Pagos" y CTA corregidos.
- [ ] QW7 error en admin · QW8 404 vs error + título de pestaña · QW10 anuncios de DnD en español · QW11 copy de `MP_NOT_CONFIGURED`.
- [ ] QW13 fila de carga en mobile · QW15 contraste · QW16 `:focus-visible` global · QW17 campanita oculta a anónimos · QW18 solicitudes vencidas (el server ya las rechaza por L5).

### L9 — Cuentas y verificación · 1ª SEMANA · M
Archivos: `users.{service,schemas}.ts`, `lib/mercadopago.ts`, `lib/auth.ts`, schema Prisma, `pages/AdminVerifications.tsx`, `pages/Login.tsx`.
Tests: `tests/users.service.test.ts`, `tests/app.test.ts`.
- [ ] Guardar `refresh_token` cifrado y renovarlo con el scheduler de L4; avisar al fletero si falla — 01§2, 02#17 — `users.service.ts:664,713` — test: token por vencer → refresh.
- [ ] `state` de OAuth de un solo uso (nonce persistido) — 02#17 — test: reusar `state` → 400.
- [ ] CUIT con dígito verificador; admin no puede aprobar sin CUIT, confirmación, `requestedAt` real — U18 — test: CUIT inválido → 400.
- [ ] Rol y estado leídos de la base en `requireAuth` (o revocar tokens al cambiarlos) — 02§2.2 — test: usuario degradado pierde acceso al instante.
- [ ] Recuperar contraseña por mail (token de un uso, 1 h) — 03/Ingresar#2 — test del flujo completo.
- [ ] Admin en la navegación y login de ADMIN a `/admin` — 03/Admin#3.

### L10 — Diseño · DESPUÉS · L (partible por pantalla)
- [ ] Componente línea de tiempo `Reserva → Seña → Confirmación → Salida → Saldo` en fila, "mis cargas", retorno y mails — 03§1.3, 03§4.
- [ ] Sistema: un naranja por pantalla, `outline` navy/danger, escala de estados de pago, sentence case + voseo, chips unificados — 03§3, 03§4.
- [ ] Landing con un viaje real y su diagrama, un CTA por rol, sin testimonios ficticios — 03/Landing#2-5.
- [ ] Listado: "$ 60 / m³ · 30 m³ libres" como dato principal, filtros compactos, tarjeta-link con mini diagrama, "Reintentar" — 03/Listado#1-5.
- [ ] Detalle en dos columnas con panel fijo "Tu carga"/"Antes de salir" y barra de estado; barra fija abajo en mobile — 03/Detalle#4, 03/Confirmar#3.
- [ ] Publicar en 2 columnas con checklist de requisitos; "aceptar solicitud" lleva a `/viajes/nuevo` precargado — 03/Publicar#2-4, 03/Solicitudes#2-4.
- [ ] Paradas: misma numeración en mapa y lista, "Orden guardado"; targets táctiles ≥ 44 px — 03/Paradas#2-3, 03§3.

### L11 — Deuda técnica · DESPUÉS · M
- [ ] Partir `trips.service.ts` (cargas, mensajes, ubicación, paradas, tracking, reembolsos); unificar `round2` y el retry P2034; `balanceOf` a `lib/` — 01§3.
- [ ] Saldo del cliente desde el server; `Login` y `lib/cancellation.ts` vía hooks — 01§3.
- [ ] JWT en cookie httpOnly (hoy un XSS = robo de sesión); registro sin enumerar emails — 02§2.4, 02§2.6.
- [ ] Unit tests de cliente (vitest) para los hooks de dinero — 01§4.

## 3. Orden y dependencias
```
D1, D3, D4, D5 decididas ──► antes de L4/L6/L7
L1 ──► L4 ──┬──► L7 ──► (prueba MP sandbox de punta a punta) ──► LANZAMIENTO ──► L8, L9 ──► L10, L11
L2 ──► L3 ──┘      ▲
R1, R2 ────────────┘ (e2e de L3/L7)        L5, L6: independientes, en cualquier hueco antes
```
Secuencia: **L1 → L4 → L2 → L3 → L5 (+R4) → L6 → L7** → gate → L8 → L9 → L10 → L11.
L11 al final porque mueve archivos que tocan L1–L4. **Gate**: todos los BLOQUEANTE tildados;
server `npm test`/`typecheck`/`lint`; client `lint`/`build`; e2e verdes; homologación MP; pago
real con montos chicos (seña, saldo, retiro a 30 h → 50 %, salida con una PENDING).

## 4. Infra para producción
- **Frontend**: SPA estática en Cloudflare Pages / Vercel / Netlify, fallback a `index.html`. Ahí van los headers y la **CSP** que hoy no existe (02§2.4): `connect-src` a la API, `img-src` a los tiles, `frame-ancestors 'none'`.
- **Backend**: contenedor Node en Render / Railway / Fly.io, región São Paulo. **Una sola instancia** al inicio: rate limits, cola de Nominatim y caché de geocoding viven en memoria. Release con `npx prisma migrate deploy`; health check (crear `GET /api/health` si no existe).
- **Postgres administrado**: Neon / Supabase / Railway / RDS en `sa-east-1`, TLS obligatorio.
- **Geocoding/rutas**: Nominatim y OSRM públicos no son para producción con volumen; `NOMINATIM_USER_AGENT` con contacto y evaluar proveedor pago vía `NOMINATIM_URL`.
- **Túnel HTTPS para MP**: `cloudflared tunnel` (o ngrok) a la API local → `API_PUBLIC_URL`; `APP_URL` al front de staging. Webhook en el panel de la app MP con su secret. Usuarios de prueba: vendedor (fletero vía OAuth) y comprador (empresa). No exponer el inspector del túnel (vector de 02#3). Ideal: un staging desplegado con credenciales de prueba.
- **Variables (nombres)** — server: `NODE_ENV`, `PORT`, `API_PREFIX`, `DATABASE_URL`, `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CORS_ORIGIN`, `TRUST_PROXY`, `AUTH_RATE_LIMIT_MAX`, `APP_URL`, `API_PUBLIC_URL`, `MP_ACCESS_TOKEN`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `NOMINATIM_URL`, `NOMINATIM_USER_AGENT`, `MAX_STOP_DISTANCE_FROM_ROUTE_KM`; nuevas: `SENTRY_DSN` y las de `admin:create`. Client: `VITE_API_URL`, `VITE_SENTRY_DSN`.
- **Backups**: PITR del proveedor (≥ 7 días) + `pg_dump` diario cifrado a otro proveedor (30 días). Probar una restauración antes de lanzar y una vez por mes: `Payment` y `RefundRequest` son la contabilidad.
- **Monitoreo**: Sentry en server y client con `beforeSend` que borre `Authorization`, cookies y bodies; uptime check sobre el health; alertas por `RefundRequest` FAILED o PENDING > 1 h y por webhooks con 401/503.
- **Dominio y mails**: `app.` y `api.` del dominio propio; Resend con dominio verificado (SPF, DKIM, DMARC), `EMAIL_FROM` tipo `TruckPool <avisos@…>`, reply-to a soporte.
- **MP producción**: credenciales productivas de la app Marketplace; redirect URI de OAuth exacta al callback de `API_PUBLIC_URL`; webhook productivo con secret distinto del de prueba. **Checklist de homologación**: `external_reference`, `notification_url`, `back_urls` + `auto_return`, `statement_descriptor`, ítems completos (título, descripción, categoría, cantidad, precio), email del pagador, `marketplace_fee`, vencimiento de la preferencia alineado con las 24 h de la reserva, idempotency key en pagos y reembolsos, reembolso parcial probado, `payment.updated` manejado. Correr el quality checklist/evaluación de MP antes de pedir la homologación.
- **Legal**: términos y condiciones (política de retiro incluida), política de privacidad (Ley 25.326) y facturación de la comisión.

## 5. Tareas de repo
- [ ] **R1** `client/playwright.config.ts`: `baseURL` `http://localhost:5174`, `testDir: tests-e2e`, `webServer` del client; fixtures con los usuarios del seed (`flete@`, `empresa@`, `admin@truckpool.app` / `truckpool123`). Va antes de L3/L7.
- [ ] **R2** `tests-e2e/profile.spec.ts`: usa `empresa@test.com`/`carrier@test.com` con `password123` (no existen en el seed) y URLs absolutas → `page.goto("/perfil")` + login por helper de R1.
- [ ] **R3** README: estructura real de `server/`, cancelación vía `/trips/cancellation-quote`, credenciales demo como solo-dev, `admin:create`, env vars nuevas y sección de deploy.
- [ ] **R4** Separar seeds: `seed-demo.ts` (bloqueado en prod) y `seed-prod.ts` idempotente sin usuarios; scripts `db:seed:demo` y `admin:create`. En la misma sesión que L5.
- [ ] **R5** CI (GitHub Actions): server `typecheck`/`lint`/`test`, client `lint`/`build`.

## 6. Decisiones de producto
Todas DECIDIDAS el 2026-11-03. Las opciones descartadas quedan como contexto.
- **D1. ¿La empresa puede confirmar su propia carga? — DECIDIDA: (a) solo el fletero**, con aviso al fletero cuando se acredita la seña: confirmar es el compromiso de llevarla. Descartadas: (b) ambos (comportamiento actual); (c) auto-confirmar al acreditarse la seña. → L7.
- **D2. ¿Se pueden reordenar paradas en tránsito? — DECIDIDA: (b) sí, avisando a las empresas afectadas** (las rutas cambian en la realidad). Descartadas: (a) no; (c) solo paradas no visitadas, a revisar cuando exista "parada visitada". → L4.
- **D3. ¿Qué pasa con las PENDING al salir? — DECIDIDA: (a) se cancelan todas, con reembolso 100 % si hay seña**; el diálogo de L7 ofrece confirmar antes. Descartadas: (b) auto-confirmar las que tienen seña (obliga al fletero a llevar algo que no aceptó); (c) no poder salir con PENDING con seña (una empresa que no responde bloquea la salida). → L4, L7.
- **D4. ¿Se puede retirar una carga CONFIRMED? — DECIDIDA: (b) hasta la salida, con la misma penalidad**: es la política que se publica. Descartadas: (a) nunca (comportamiento actual); (c) solo con acuerdo del fletero. → L4, L7.
- **D5. ¿Rango de precio ±15 % de la sugerencia? — DECIDIDA: (b) solo aviso**: la sugerencia depende de un geocoding best-effort. Descartadas: (a) obligatorio (comportamiento actual); (c) sin sugerencia. → L6.
- **D6. ¿Qué pasa si el fletero no sale? — DECIDIDA: (a)+(b), X = 24 h**: estado de viaje CANCELLED con reembolso 100 % de todas las señas, y auto-cancelación si el viaje no pasa a IN_TRANSIT 24 h después de la salida. Descartada: (c) soporte manual. → L4, L7.
- **D7. ¿De quién es la penalidad retenida y la comisión al reembolsar? — DECIDIDA: penalidad para el fletero, comisión solo sobre lo efectivamente cobrado.** Pendiente de verificar en sandbox cómo MP reparte `marketplace_fee` en reembolsos parciales, antes del gate (§3).
- **D8. ¿Alcanza el CUIT para verificar? — DECIDIDA: (a) CUIT validado + chequeo manual en AFIP** para lanzar. Descartada por ahora: (b) documentos (DNI, cédula, seguro) con almacenamiento privado, que queda para después. → L9.
