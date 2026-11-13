# 05 — Revisión de diseño (etapa entre L7 y el gate)
Etapa «Revisión de diseño» de `04-launch.md` §3. Usa la escala de `03-diseno.md`: **P1** engaña o
rompe la tarea · **P2** confunde o es inconsistente · **P3** pulido. Capturas en
[`screens-revision/`](./screens-revision/). Rutas de código relativas a `client/src/` salvo que se
indique.

## 0. Método y alcance
- **Fecha y base**: 2026-11-13, rama `feat/revision-diseno` desde `main` (`5345d78`, L1–L7
  mergeados). No se cambió código.
- **Entorno**: Postgres de docker compose. La API corrió con `JOBS_ENABLED=false` y
  `RESEND_API_KEY` vacía (para no mandar emails reales: el log dice «se omite el envío») y el
  client en `:5174`. Antes se corrió `npm run db:seed:e2e`.
- **Navegador**: Playwright (Chromium 156), con contextos de 1440×900 y de 390×844 (`isMobile`,
  touch), locale `es-AR` y zona `America/Argentina/Buenos_Aires`. Sesiones de anónimo,
  `empresa@`, `flete@`, `admin@`, ex participante (`e2e-ex@`, y `e2e-otra@` después de D3) y
  otra empresa.
- **Chequeos automáticos en cada captura**: axe-core 4.10.2 (WCAG 2.2 AA), ancho real de la
  página en mobile (`scrollWidth` contra 390), targets de menos de 44 px, título de la pestaña,
  errores de consola y recorrido con Tab en ingresar, detalle y diálogo.
- **Mercado Pago, sin tokens reales**: en el navegador se interceptó todo dominio de MP con un
  checkout simulado (`11-pagar-sena-checkout-simulado-*`). La preference
  (`POST /cargo-items/:id/payment-preference`) se interceptó en todos los casos, así que el
  server nunca la pidió. Los estados de pago de `/pagos/retorno` y las ventanas de la
  cotización de retiro salieron de respuestas interceptadas.
- **Real, sin plata de por medio**: reservar y retirar (sin seña cobrada) en
  `e2e-trip-cancel`. Salir con el «¿salís ahora?» en `e2e-trip-lifecycle`, confirmando adentro
  la carga con seña: se cancelaron solo cargas sin seña, así que no hubo reembolsos. Cancelar
  `e2e-trip-cancel`, con una sola carga sin seña.
- **Qué se tocó en la base y cómo quedó**:
  - Para poder reservar, `flete@` tuvo un `mpUserId`/`mpAccessToken` falso
    (`revision-diseno-falso`, que no se puede descifrar: cualquier llamada a MP falla antes de
    salir). Volvió a `null` al terminar.
  - Se volvió a correr `db:seed:e2e`, así que los viajes e2e quedaron como antes.
  - Quedan los avisos in-app que generaron la salida y la cancelación, para `empresa@`,
    `e2e-otra@` y `flete@`.
- **Fuera de alcance**: emails (Resend apagado), la vuelta automática de MP (`back_urls`, es del
  gate), dispositivos reales, publicar un viaje de punta a punta y reordenar paradas con el
  mouse.

## 1. Chequeo manual pendiente de L3 (paradas sin recargar) — OK
- **Al reservar** como `empresa@` en `/viajes/e2e-trip-cancel`, desktop y mobile: antes no
  había sección «paradas de retiro» (no participante). Después de «sumar carga» aparece con la
  parada nueva («2 · Bv. Oroño 1200, Rosario · pendiente») y la ajena («otra parada · 2 m³ ·
  retiro en Rosario»), sin recargar la página (un marcador en `window` sobrevivió). La reserva
  tardó ~0,9 s.
  - Capturas: [antes](./screens-revision/10-reservar-antes-desktop.jpg) →
    [creada](./screens-revision/10-reservar-creada-desktop.jpg).
- **Al retirarla**: la sección desaparece sin recargar, porque la empresa deja de participar, y
  la fila queda «retirada · retirada sin seña cobrada»
  ([captura](./screens-revision/13-retirar-hecho-desktop.jpg)).
- Se puede tildar en `04-launch.md`. Ver RD4: el mismo refresco **falta** al salir, al cancelar
  el viaje y al confirmar una carga.

## 2. Hallazgos nuevos
`¿Anotado?` dice si ya estaba en L8 o L10 (o en otro lote) antes de esta revisión.

### P1
| ID | Hallazgo | Captura | ¿Anotado? |
|---|---|---|---|
| RD1 | **En mobile, el header del fletero desborda y deja el menú fuera de pantalla.** Con sesión de CARRIER, el header suma «Publicar viaje» y todas las páginas pasan a medir **453 px**: la hamburguesa queda en x=413, fuera de los 390. Sin scroll horizontal, el fletero no llega a la navegación. Además, los diálogos se centran sobre esos 453 px y cortan el botón principal: en «¿salís ahora?» no se ven completos «salir con 1 carga» ni «confirmar». Lo mismo con «cancelar viaje» y «aceptar solicitud». La empresa y el anónimo no desbordan. | [header](./screens-revision/03-fletero-header-desborde-mobile.jpg) · [¿salís ahora?](./screens-revision/14-salir-dialogo-mobile.jpg) · [cancelar](./screens-revision/15-cancelar-viaje-dialogo-mobile.jpg) | No. 03 midió el header sin sesión de fletero. |
| RD2 | **La landing contradice el producto que se lanza** (03/Landing#1, sigue igual): «MVP: … Próximamente: Chat, **Pagos**, IA», «EMPRESAS: PUBLICAR CARGA», «TRANSPORTISTAS: ENCONTRAR CARGA», «Negocia tarifas, acepta ofertas» (el precio es fijo por m³) y testimonios ficticios con disclaimer. El día del lanzamiento la primera pantalla dice que los pagos todavía no existen. | [desktop](./screens-revision/01-anon-landing-desktop.jpg) · [mobile](./screens-revision/01-anon-landing-mobile.jpg) | Sí: L8 (QW5); testimonios y CTA por rol en L10. Con la regla del gate tiene que ir antes. |

### P2
| ID | Hallazgo | Captura | ¿Anotado? |
|---|---|---|---|
| RD3 | **La fila de la carga en mobile no se lee justo donde está la plata.** Los textos de seña, saldo y «reservado hasta…» quedan en una columna de 1–2 palabras, con «retirar carga» y «pagar seña» al costado. Con la seña pagada, «retirar carga» se sale **22 px de la tarjeta** (termina en x=388, la tarjeta en 366). | [recorte](./screens-revision/02-empresa-fila-carga-recorte-mobile.jpg) · [con error](./screens-revision/11-pagar-sena-error-sin-mp-mobile.jpg) · [detalle](./screens-revision/02-empresa-detalle-ciclo-mobile.jpg) | Sí: L8 (QW13). Era 03/Detalle#5, P2. |
| RD4 | **Datos viejos después de salir, de cancelar el viaje o de confirmar una carga.** `useUpdateTripStatus` (salir, D3; cancelar, D6) y `useConfirmCargoItem` invalidan `trip`/`trips`, pero no `tripStops` ni el recorrido. Después de cancelar el viaje, el fletero sigue viendo la parada de la carga cancelada como «pendiente», con «arrastrá los ítems para cambiar el orden», aunque el server ya devuelve `[]`. Al confirmar, la parada sigue «pendiente». Se corrige recargando. | [cancelado](./screens-revision/15-cancelar-viaje-hecho-desktop.jpg) | No. L3 sumó la invalidación solo a reservar y retirar. |
| RD5 | **Copy de plata sin monto ni sujeto**: «retirada con costo: **se quedaron 21** de la seña.» (y «cancelada con costo: …» en las de antes del motivo). Le falta el `$` y el formato `$ 21,00`, no dice quién se lo quedó ni cuánto se devolvió. Sale en la fila del detalle y en «mis cargas». `lib/cancellation.ts:91,98`. Propuesta: «retirada: el fletero retuvo $ 21,00 de la seña y te devolvimos $ 21,00.» | [mis cargas](./screens-revision/02-empresa-perfil-desktop.jpg) (fila Villa Adelina → San Isidro) | No. |
| RD6 | **El diálogo de retiro cerrado se contradice**: «el viaje ya salió: la carga no se puede retirar. **si el viaje no sale**, se cancela y te devolvemos…». `CLOSED` también llega cuando pasó la hora de salida y el fletero todavía no marcó la salida, o cuando hay saldo, así que «ya salió» puede ser falso. `WithdrawCargoDialog.tsx:57-60`. Propuesta: «ya pasó la hora de salida: la carga no se puede retirar. si el fletero no sale en las próximas 24 h, el viaje se cancela solo y te devolvemos toda la seña.» | [desktop](./screens-revision/13-retirar-dialogo-cerrada-desktop.jpg) · [mobile](./screens-revision/13-retirar-dialogo-cerrada-mobile.jpg) | No. |
| RD7 | **Reservar no confirma nada.** Después de «sumar carga» el formulario se vacía en su lugar (abajo de todo), sin mensaje y sin llevar a la fila nueva, donde está «pagar seña» y el vencimiento de 24 h. Parece que no pasó nada; si se vuelve a enviar, el tope responde (con buen copy: «ya tenés una reserva sin seña en este viaje…»). | [creada](./screens-revision/10-reservar-creada-desktop.jpg) · [tope](./screens-revision/10-reservar-tope-por-viaje-desktop.jpg) | En parte: el panel «Tu carga» de 03/Detalle#4 (L10) lo resolvería. El aviso y el scroll no están anotados. |
| RD8 | **El login no vuelve a donde estabas.** «ingresar» desde un viaje lleva a `/ingresar` sin destino y, después, a `/viajes` (empresa) o `/viajes/nuevo` (fletero) (`Login.tsx:63`). Pierde el viaje que se iba a reservar. `/pagos/retorno` sin sesión dice «ingresá y volvé a esta página», pero el login no vuelve. | [retorno sin sesión](./screens-revision/12-retorno-sin-sesion-desktop.jpg) | No. |
| RD9 | **`/rastrear` con un resultado desborda en mobile**: la página pasa a 473 px y «limpiar» queda fuera de pantalla; «← volver al inicio» se parte en 3 líneas. | [mobile](./screens-revision/01-anon-rastrear-valido-mobile.jpg) | No. 03/Rastrear#4 vio el corte en desktop. |
| RD10 | **Un viaje o un fletero que no existen muestran ~8 s de skeleton** (reintentos sobre el 404) antes del error. El del viaje después dice «no pudimos cargar este viaje.», sin link de vuelta. Afecta a links compartidos de viajes borrados. | [cargando](./screens-revision/01-anon-detalle-inexistente-desktop.jpg) · [final](./screens-revision/01-anon-viaje-final-desktop.jpg) · [fletero](./screens-revision/01-anon-fletero-final-desktop.jpg) | En parte: L8 (QW8) cubre el copy y el link; el `retry: false` en 404 de `useTrip` y del perfil del fletero no está. |

### P3
| ID | Hallazgo | Captura | ¿Anotado? |
|---|---|---|---|
| RD11 | Footer: «Para Empresas», «Para Transportistas», «Precios» y las cuatro redes apuntan a `#`. Los links del footer tienen contraste 2,71:1 (#646e7a sobre navy): son los 7 nodos que axe marca en **todas** las páginas. | [landing](./screens-revision/01-anon-landing-desktop.jpg) | Contraste: L8 (QW15), que solo nombra el copyright. Links muertos: no. |
| RD12 | Dashboard de admin: «MONTO FACTURADO $ 180.869 · pagos aprobados» suma lo que pagaron las empresas, no lo que factura la plataforma (la comisión). Además, «COMPLETOS 0» (FULL) al lado de «FINALIZADOS 7», labels en ALL CAPS y una nota de desarrollo («km evitados: no se calcula (fase 14…)»). Con error, muestra el texto crudo «error interno». | [dashboard](./screens-revision/05-admin-admin-desktop.jpg) · [error](./screens-revision/06-estado-admin-dashboard-error-desktop.jpg) | No. |
| RD13 | «mis cargas» muestra 39 cargas en una sola lista, sin separar activas (con plata pendiente) de historial; las canceladas tapan las vivas. | [perfil](./screens-revision/02-empresa-perfil-desktop.jpg) | En parte: L10 (línea de tiempo en «mis cargas»). |
| RD14 | Avisos (in-app y el texto del email): bajan a minúscula lo que escribió la empresa («tu carga **e2e ciclo sin seña**», «maquinaria industrial»), formatean la plata distinto que la UI («$400 de saldo de $500» contra «$ 400,00») y tienen frases torcidas («Transportes Flete salió, donde va tu carga…»). | [aviso](./screens-revision/15-cancelar-viaje-aviso-empresa-desktop.jpg) | No. |
| RD15 | Cuando hay botón de pago, la fila no muestra el estado de la carga (pendiente/confirmada); los chips cancelados van tachados y cuestan leerse; «retirar carga» se parte en 2 líneas en desktop; las etiquetas del diagrama se cortan («E2E ciclo sin se»). | [detalle](./screens-revision/02-empresa-detalle-ciclo-desktop.jpg) | En parte: L10 (chips unificados). |
| RD16 | «sumar carga a este viaje» aparece en viajes cancelados o en tránsito («este viaje está en viaje y ya no admite…») y a la empresa que ya tiene una reserva sin seña en ese viaje (falla al enviar, con buen mensaje). | [cancelado](./screens-revision/15-cancelar-viaje-vista-empresa-desktop.jpg) | No. |
| RD17 | Errores de pago sin próximo paso: «no pudimos generar el link de pago con Mercado Pago» no dice si reintentar; si falla la cotización de retiro, el diálogo deja retirar igual («te lo confirmamos al retirar»). | [MP_ERROR](./screens-revision/11-pagar-sena-error-mp-desktop.jpg) · [cotización](./screens-revision/13-retirar-dialogo-error-desktop.jpg) | No. |
| RD18 | Publicar: «no pudimos calcular una sugerencia, ingresalo vos» aparece antes de escribir origen y destino; la política dice «48hs», en el detalle dice «48 h». | [publicar](./screens-revision/03-fletero-publicar-desktop.jpg) | No. |
| RD19 | Listado: la hora sale dos veces («22/11/2026 · 08:00» y el chip «sale 08:00»); los lugares mezclan formatos («Rosario, Santa Fe → Córdoba, Argentina»); en desktop, el fletero ve dos CTA naranjas para publicar (header y página). | [listado](./screens-revision/01-anon-viajes-desktop.jpg) · [fletero](./screens-revision/03-fletero-viajes-desktop.jpg) | En parte: L10 (Listado, un naranja por pantalla). |
| RD20 | Estados menores: `/solicitudes` sin sesión, 8 s de skeleton y después en blanco; como empresa, `/solicitudes` dispara 2 × 403 en consola; el marcador de ubicación de Leaflet es `role="button"` sin nombre (axe `aria-command-name`); «Iniciar Sesión» en Title Case. | [solicitudes](./screens-revision/01-anon-solicitudes-final-desktop.jpg) | No. |

## 3. P1 y P2 de `03-diseno.md` que siguen abiertos (reproducidos hoy)
La regla del gate («revisión de diseño sin P1 ni P2 abiertos») también alcanza a estos.
| 03 | Prioridad hoy | Estado en esta revisión | Lote |
|---|---|---|---|
| Landing#1 | P1 | Igual (es RD2). | L8 QW5 |
| Landing#2-3 | P2 | ALL CAPS, tuteo («Conecta», «Crea tu cuenta», «Sube tu carga») y la elección repetida tres veces. | L10 |
| Ingresar#1 | P2 | Con «1234», el login responde «la contraseña debe tener al menos 8 caracteres»; sin `autocomplete` ([captura](./screens-revision/08-ingresar-contrasena-corta-desktop.jpg)). | L8 QW3 |
| Ingresar#2 | P2 | Sin «¿olvidaste tu contraseña?». | L9 |
| Listado#1 | **P1 → P2** | Sigue el precio del camión como dato principal, pero desde L7 la empresa ve precio, seña y saldo antes de reservar: ya no engaña, confunde. | L10 |
| Listado#2-4 | P2 | Los filtros siguen ocupando el primer pantallazo, sigue «Ventana de viajes» y el error sigue sin «reintentar» ([error](./screens-revision/06-estado-viajes-error-desktop.jpg)). El copy de #3 no está en la línea de L10. | L10 |
| Detalle#4 | P2 | Sumar carga sigue al final, debajo de mensajes (ver RD7). | L10 |
| Detalle#5 | P2 | La pestaña sigue diciendo «Viajes abiertos» en todo detalle; 404 y 500 siguen iguales; la fila mobile es RD3. «una empresa comparten» ya está resuelto. | L8 QW8, QW13 |
| Publicar#2 | **P1 → P2** | Sin MP el formulario sigue reemplazado por una tarjeta ([captura](./screens-revision/08-publicar-sin-mp-desktop.jpg)). En producción `env.ts` exige la config de MP, así que el «falta MP_CLIENT_ID» al fletero ya no puede pasar (P3). | L10, L8 QW11 |
| Publicar#3-4 | P2 | La fecha se sigue cortando («mm/dd/y»); la leyenda de los pines sigue pendiente. | L10 |
| Paradas#1 | P2 | Los anuncios siguen en inglés y con ids («Draggable item cmweb… was moved over…»). | L8 QW10 |
| Paradas#2 | P2 | La numeración del mapa y de la lista sigue sin coincidir. | L10 |
| Solicitudes#1 | **P1 → P2** | El server las rechaza desde L5, pero la del 30/9 sigue «pendiente» con «aceptar». | L8 QW18 |
| Solicitudes#2-3 | P2 | El modal sigue sin `role="dialog"` y Escape no lo cierra; en mobile, encima, RD1 ([captura](./screens-revision/09-solicitud-aceptar-mobile.jpg)). | L10 |
| Confirmar#3 | P2 | Sin barra de estado; el checklist «antes de salir» queda debajo del botón. | L10 |
| Admin#1 | P1 | No se reprobó: no había pedidos pendientes y no se simularon. L9 sigue sin tildar. | L9 |
| Admin#2 | P2 | Con un 500, la página queda en blanco ([captura](./screens-revision/06-estado-admin-verif-error-desktop.jpg)). | L8 QW7 |
| Admin#3 | P2 | El admin sigue sin entrada en la navegación. | L9 |
| §3 foco | P2 | Links y header con el outline de 1 px del navegador; los inputs, solo con el cambio de borde. Los botones y los diálogos están bien: foco en «mantener», Tab atrapado, Escape y vuelta del foco. | L8 QW16 |

**Aceptados para el gate (decisión 2026-11-13)**: los P2 de 03 que dependen de L9 o L10 quedan
abiertos y no bloquean el gate. Son:
- L10: Landing#2-3, Listado#1-4, Detalle#4, Publicar#2-4, Paradas#2, Solicitudes#2-3 y
  Confirmar#3.
- L9: Ingresar#2 y Admin#3.

Los de L8 (QW3, QW7, QW8, QW10, QW13, QW18 y QW5, que es P1) se adelantan y se arreglan antes del
gate (§4). Quedan por decidir Admin#1 (P1, L9) y el foco de §3 (P2, L8 QW16), que la regla no
cubre.

**Lo que L1–L7 dejó resuelto y se verificó acá:** el retorno del pago (los 6 estados, en
desktop y mobile, nunca usa el `?status`), el diálogo de retiro con desglose por ventana, «¿salís
ahora?» con confirmar adentro, «cancelar viaje» con el conteo de señas, el confirmar solo para
el fletero, terceros sin datos ajenos, paradas solo para participantes, `/rastrear` rápido con el
404, el error de pago en la fila con el botón deshabilitado, «reservado hasta…», el resumen de
precio y la política antes de reservar, la etiqueta de la carga cancelada según el motivo, el
aviso de saldo al salir y el chat del ex participante (D9).

## 4. Decisiones (2026-11-13) y lo que se arregla antes del gate
Se arregla en `feat/revision-diseno`, un commit por hallazgo, con e2e cuando aplica:
- [x] RD1 — header del fletero y diálogos en mobile. A menos de 640 px, «publicar viaje» queda solo en el menú móvil. `ConfirmDialog`, `Modal` y el modal de solicitudes tienen un tope de alto con scroll. e2e `mobile-layout.spec.ts`.
- [x] RD2 / QW5 — copy de la landing: fuera la línea «MVP… Próximamente: Pagos»; los CTA son «Buscar un viaje para mi carga» (`/viajes`) y «Publicar mi viaje» (`/viajes/nuevo`), también en «Nosotros»; los pasos y las tarjetas por rol dicen lo que hace cada uno (reservar y pagar la seña a precio fijo por m³, publicar el viaje y cobrar por MP). El ALL CAPS y el tuteo que quedan son Landing#2 (L10). e2e `landing.spec.ts`.
- [x] RD3 / QW13 — fila de la carga en mobile: se apila (estados, datos y botones a lo ancho, de 44 px), y en desktop sigue en una línea con los botones sin partirse. e2e en `mobile-layout.spec.ts`.
- [x] RD4 — invalidar paradas y recorrido al salir, cancelar el viaje y confirmar una carga. `hooks/invalidateTripCargo.ts`, usado por las cuatro mutaciones (también refresca la cotización de retiro y «mis cargas»). e2e: «cancelar de verdad» en `cargo-lifecycle.spec.ts`.
- [x] RD5 — copy de la retención de la seña: «retirada: se retuvieron $ 21,00 de la seña y se devolvieron $ 21,00.», en impersonal porque la nota la leen la empresa y el fletero. e2e: «lo que se retuvo de la seña» en `cargo-lifecycle.spec.ts`.
- [x] RD6 — copy del retiro cerrado según el estado del viaje: con el viaje abierto y la hora pasada, «ya pasó la hora de salida… si el fletero no sale dentro de las 24 h, el viaje se cancela solo y te devolvemos toda la seña que hayas pagado.» (D6); con el viaje en camino, «el viaje ya salió…». e2e en `cargo-lifecycle.spec.ts`.
- [x] RD7 (mínima) — aviso de que reservaste y scroll a la fila: «listo, reservaste tu lugar. pagá la seña para confirmarlo.» en la fila nueva (resaltada), que se lleva a la vista una sola vez. e2e `reserve-feedback.spec.ts`.
- [x] RD8 — el login vuelve a donde estabas: `/ingresar?volver=<ruta>` desde el header, el detalle, el retorno del pago, el perfil y publicar; solo rutas internas (`lib/returnTo.ts`). e2e `login-return.spec.ts`.
- [x] RD9 — `/rastrear` con resultado en mobile: «← volver al inicio» arriba y la fila del buscador se parte; la página queda en 390 px. e2e en `mobile-layout.spec.ts`.
- [x] RD10 / QW8 — 404 sin reintentos, copy y link de vuelta, y título de la pestaña. `retryUnlessDenied` es el default de todas las queries (también saca los 8 s de `/solicitudes` sin sesión de RD20). En el detalle, 404 → «este viaje no existe o ya no está publicado» + «ver viajes disponibles»; otro error → «reintentar». La pestaña dice «origen → destino» y el título por ruta matchea `/viajes/:id`. e2e `not-found.spec.ts`.
- [ ] QW3 — login sin mínimo en «acceder» y con `autocomplete`.
- [ ] QW7 — error de las verificaciones de admin.
- [ ] QW10 — anuncios del arrastre en español.
- [ ] QW18 — solicitudes vencidas sin acciones.

La regla del gate queda en `04-launch.md` §3: cero P1, cero P2 nuevos y los P2 de 03 que
dependen de L9 o L10 aceptados (§3). Los P3 (RD11–RD20) van a L8 o L10.
