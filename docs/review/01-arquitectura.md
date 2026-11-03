# 01 — Arquitectura (Fase A)
Complementa CLAUDE.md. Rutas relativas a `server/` salvo `client/…`.

## 1. Flujo viaje → pago → cierre
1. **Conectar MP** (prerequisito de publicar): `client/src/hooks/useConnectMp.ts:16` → `getMpAuthUrl` `modules/users/users.service.ts:654` → callback `modules/users/users.controller.ts:156` → `exchangeMpCode` `users.service.ts:675` (token cifrado `:728`).
2. **Publicar**: `useCreateTrip.ts:9` → `trips.routes.ts:54` → `createTrip` `trips.service.ts:387` (VERIFIED `:397`, `mpUserId` `:399`, geocode `:411`, rango de precio solo si geocodificó `:420`).
3. **Reservar**: `useAddCargoItem.ts:10` → `addCargoItem` `trips.service.ts:1033` (priceShare `:1062`, seña `:1069`, `Payment DEPOSIT` PENDING `:1121`, FULL `:1126`). Vence a 24 h vía `releaseExpiredReservations` `:223`, perezoso: solo corre en `listOpenTrips` `:144` y `getTripById` `:296`.
4. **Pagar seña**: `useCreatePaymentPreference.ts:26` → `createPaymentPreference` `payments.service.ts:86` (CAS de reintento `:147`, split `:186`) → `createCheckoutPreference` `lib/mercadopago.ts:150` con token del carrier `:184` → redirect `useCreatePaymentPreference.ts:31`. Retorno `client/src/pages/PaymentReturn.tsx:8` solo lee `?status=`.
5. **Webhook**: `payments.routes.ts:13` → `payments.controller.ts:48` → `verifyWebhookSignature` `lib/mercadopago.ts:544` → `handlePaymentNotification` `payments.service.ts:228` (lookup `:296`; carga CANCELLED → reembolso total `:248`; resto → `status: state` `:257`).
6. **Confirmar**: `useConfirmCargoItem.ts:10` → `confirmCargoItem` `trips.service.ts:670` (exige DEPOSIT APPROVED `:704`). No hay auto-confirmación al acreditarse la seña.
7. **Salida**: `useUpdateTripStatus.ts:10` → `updateTripStatus` `trips.service.ts:471`; IN_TRANSIT crea `Payment BALANCE` por carga CONFIRMED `:534` y avisa `:637`. El saldo se paga por el mismo endpoint con `type: "BALANCE"` (`payments.service.ts:126`).
8. **Tracking**: `usePostLocation.ts:11` → `recordTripLocation` `trips.service.ts:1530` (solo IN_TRANSIT); participantes `getTripLocation` `:1555`; público `src/app.ts:68` → `getPublicTracking` `trips.service.ts:1972` (`client/src/hooks/useTripStops.ts:32`).
9. **Completar**: `updateTripStatus` COMPLETED exige saldo APPROVED en cada CONFIRMED (`:507`).
10. **Cancelar**: `useCancelCargoItem.ts:15` → `cancelCargoItem` `trips.service.ts:773` (solo PENDING y viaje OPEN/FULL `:797`/`:806`; quote `:815`; outbox `RefundRequest` `:830`) → post-commit `processRefundRequest` `:912`→`:2019` → `refundPayment` `lib/mercadopago.ts:486`.

## 2. Desvíos de invariantes
- **Mapper por omisión, no whitelist**: `toCargoItemResponse` hace `...rest` (`lib/mappers.ts:94-98`) y expone `pickupLat/Lng` (`:111`) y `departureLat/Lng` (`:66`). `GET /trips/:id` es público (`trips.routes.ts:53`): sin sesión se ven `companyId`, dirección/coords de retiro, `trackingCode` y pagos de todas las empresas.
- **Orden de rutas**: `GET /payments/mp/:id` (`payments.routes.ts:34`) va antes de `/payments/mp/test` (`:41`) → el test de conexión es inalcanzable (cae en `tracePayment("test")`).
- **HMAC a medias**: la firma cubre solo `data.id`/request-id/ts (`lib/mercadopago.ts:566`). `data.status` del body (`payments.service.ts:232`) y `?payment_id=` (`:305`, buscado antes que `mpPaymentId`) no están firmados pero deciden el resultado. Sin chequeo de frescura de `ts` (replay).
- **Estados de pago sin guardia**: `status: state` (`payments.service.ts:257-260`) sin mirar el actual → webhook tardío puede hacer APPROVED→REJECTED o REFUNDED→APPROVED.
- **Penalidad 24–48 h se pierde**: tras el reembolso parcial del outbox, cualquier webhook `approved` posterior (reenvíos de MP, `payment.updated` del propio refund) entra en la rama CANCELLED y devuelve el 100 % (`payments.service.ts:248-249`). La idempotencia de `refundPayment` es contra el monto pedido, no contra la política.
- **Token de plataforma para pagos del carrier**: `fetchPaymentState`, `refundPayment`, `refundedAmount` usan `mpConfig()` (`lib/mercadopago.ts:25,314,510,533`) aunque el pago vive en la cuenta del carrier (`:184`). El código lo admite solo para `getPaymentDetails` (`:391`). Como los webhooks reales no traen `data.status`, es el camino normal.
- **Error crudo del SDK logueado**: `fetchPaymentState` (`lib/mercadopago.ts:311`) no traduce errores → `console.error(err)` en `src/app.ts:84`.
- **Best-effort dentro de TX**: `addCargoItem` llama a `geocode` (cola 1 req/s) y OSRM dentro de la TX Serializable de 10 s (`trips.service.ts:1075,1079,1150`) → Nominatim lento hace fallar la reserva.
- **Ventana de cancelación sin hora**: `hoursUntilTrip(trip.date)` (`trips.service.ts:817`, `lib/cancellation.ts:16`) mide contra medianoche UTC (`trips.schemas.ts:50`), ignora `departureTime`.
- **Seña atrapada**: al pasar a IN_TRANSIT, las cargas PENDING con seña APPROVED quedan PENDING (`trips.service.ts:524`): no se pueden retirar (`:806`) ni generan saldo ni reembolso. Una CONFIRMED nunca se puede retirar (`:797`).
- **Outbox sin worker**: `processRefundRequest` solo se invoca inline (`:912`); un PENDING fallido no se reintenta. PROCESSING sin compare-and-set (`:2026`) y queda colgado si el proceso muere.
- **FULL→OPEN fuera de TX** en `releaseExpiredReservations` (`:277-289`): puede pisar el FULL de un `addCargoItem` concurrente (no hay sobreventa, pero el estado queda inconsistente).
- **priceShare no sale de `lib/pricing.ts`**: se calcula inline en `trips.service.ts:1062`.
- **Bug**: `getTripLocation` sin historial usa `findFirst` + `LOCATION_ASC` (`:1514`, `:1581`) → devuelve la primera posición, no la última.
- **Participantes con cargas CANCELLED**: `resolveParticipants` no filtra status (`:1295`) → quien retiró sigue viendo ubicación y mensajes.
- **trackingCode predecible** `TP-{4}-C{n}` (`:930`) en endpoint público; rate limit solo existe en auth (`modules/auth/auth.routes.ts:4`).
- **OAuth MP sin refresh**: pide `offline_access` (`users.service.ts:664`) pero descarta `refresh_token` (`:713`). `state` reutilizable durante 10 min.
- **CLAUDE.md desactualizado**: `lib/` y `modules/` están en `server/` raíz (no `src/`); `client/src/lib/cancellation.ts` ya no replica la fórmula (consulta `/trips/cancellation-quote`); `TripDetail` ya no llama a `api` directo.

## 3. Deuda técnica
- **Archivos grandes**: `modules/trips/trips.service.ts` 2073 líneas (viajes, cargas, reviews, mensajes, ubicación, paradas, rutas, manifiesto, tracking, outbox); `users.service.ts` 732 (perfil, verificación, stats admin, solicitudes, OAuth MP); `lib/mercadopago.ts` 572. Cliente: `TripDetail.tsx` 887, `TripRequests.tsx` 668, `Profile.tsx` 576, `PublishTrip.tsx` 536. Tests: `trips.service.test.ts` 3276, `app.test.ts` 2788.
- **`api` fuera de hooks**: `client/src/pages/Login.tsx:53`; `client/src/lib/cancellation.ts:32` usado imperativamente en `TripDetail.tsx:97` (sin cache de TanStack).
- **Duplicación**:
  - saldo `priceShare - depositAmount` en `client/src/pages/TripDetail.tsx:519` vs `balanceOf` `payments.service.ts:36`;
  - `round2` en `lib/cancellation.ts:58`, `lib/mercadopago.ts:527`, `trips.service.ts:90`, `TripDetail.tsx:69`;
  - loop retry P2034 copiado en `addCargoItem` (`:1041`) y `cancelCargoItem` (`:781`);
  - `trips.service` importa `balanceOf` de `payments.service` (`:22`): dependencia cruzada entre módulos.
- **Endpoints "temporales" de diagnóstico** en el router productivo (`payments.routes.ts:34-56`).

## 4. Flujos críticos sin tests
- Webhook sin `data.status` (camino real → `fetchPaymentState` con token de plataforma): los tests siempre pasan `status` (`tests/payments.service.test.ts:516`).
- Webhook repetido sobre carga CANCELLED con reembolso parcial ya hecho; transiciones inválidas APPROVED→REJECTED / REFUNDED→APPROVED.
- Webhook con `ts` viejo o `?payment_id=` manipulado bajo firma válida.
- `GET /payments/mp/test`: solo se testea `/test-preference` (`tests/app.test.ts:791`).
- Tracking público (`getPublicTracking`, `/api/tracking/:code`): 0 referencias en tests.
- Outbox: reintento de `RefundRequest` PENDING/PROCESSING colgada (no hay job que testear).
- Orden de `getTripLocation`: el mock de `findFirst` no verifica `orderBy` (`tests/trips.service.test.ts:2919`).
- Shape de `GET /trips/:id` anónimo (qué campos de otras empresas salen).
- OAuth MP: vencimiento/refresh del token del carrier.
- Cliente: sin unit tests; único e2e `client/tests-e2e/profile.spec.ts` — nada de reserva, pago ni cancelación.
