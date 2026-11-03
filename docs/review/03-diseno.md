# 03 — Diseño y UX (Fase C)
Complementa `01-arquitectura.md` y `02-seguridad-pagos.md`. Rutas de código relativas a
`client/src/` salvo que se indique. Capturas en [`screens/`](./screens/).

## 0. Método y alcance
- **Entorno**: docker compose (Postgres), API en `:4000` y client en `:5174`, recorridos con
  Playwright (Chrome). Viewports: desktop 1440×900 y mobile 390×844. En las capturas mobile se
  ven ~375 px útiles porque el Chrome con interfaz reserva 15 px para la barra de scroll; en un
  teléfono real esa barra no ocupa espacio.
- **Datos**: la base de dev no es solo el seed: tiene ~25 viajes de pruebas anteriores.
  `seed-trip-1` ya está vencido, así que el flujo de empresa se hizo sobre *Rosario → Mendoza
  1/12* (`cmuhsb8mn…`) de `flete@`.
- **Bloqueado por MP**: en local falta `MP_CLIENT_ID` y `flete@` no tiene MP conectado. Por eso
  **no se llegó a ninguna redirección a Mercado Pago**: "conectar MP" devuelve 503
  (`MP_NOT_CONFIGURED`) y "pagar seña" devuelve 409 (`MP_ACCOUNT_NOT_CONNECTED`). Se documenta
  lo que muestra la UI en cada caso.
- **Simulado** (intercepción de red de Playwright, sin tocar código ni base; las capturas
  llevan `-sim`):
  - `mpConnected: true`, para poder ver el formulario de publicar;
  - seña APPROVED, para ver el botón "confirmar carga";
  - estados vacío, carga y error de `/viajes`, detalle y admin;
  - lista de verificaciones con datos.
- **Real**: viajes sin coordenadas y mal geocodificados (había en la base), la reserva, el
  reordenamiento de paradas y el pase a "en tránsito".

### Qué quedó cambiado en la base de dev
- `empresa@` reservó dos cargas en `cmuhsb8mn…`: "8 pallets de cerámicos" por la UI y
  "6 bobinas de cable" por API.
- El fletero reordenó las paradas de ese viaje y lo pasó a **IN_TRANSIT**.
- Las dos cargas quedaron **PENDING en un viaje en tránsito**, sin pagos BALANCE. Es justo el
  caso de la "seña atrapada" (02 TOP #8).

---

## 1. Puntos de UX que salieron de A y B

### 1.1 `/pagos/retorno` solo lee `?status`
Capturas: [approved](./screens/07-pago-retorno-approved-desktop.png),
[pending](./screens/07-pago-retorno-pending-desktop.png),
[rejected](./screens/07-pago-retorno-rejected-desktop.png),
[sin status](./screens/07-pago-retorno-sin-status-desktop.png),
[mobile](./screens/07-pago-retorno-approved-mobile.png).

**Qué ve la empresa mientras el webhook no confirmó:**
- Con `status=approved` (lo que manda MP en el redirect, aunque el webhook todavía no haya
  llegado) dice **"pago recibido — ya podés confirmar la carga: el transportista la ve al
  instante."** (`pages/PaymentReturn.tsx:18-27`). Son tres afirmaciones falsas:
  - nada se verificó contra la API;
  - la seña recién cuenta como APPROVED cuando llega el webhook. Con el bug 02 #5 (token de
    plataforma) eso **no pasa nunca**;
  - "confirmar la carga" es una acción del fletero.

  Al hacer "volver al viaje", el detalle sigue mostrando "pagar seña $ 48,00". La empresa ve
  una contradicción y probablemente paga dos veces.
- Con `pending` o sin `status` dice "en un momento te avisamos", pero no hay polling ni
  garantía de notificación. Tampoco tiene ícono, mientras que los otros dos estados sí.
- **No se dice el siguiente paso** en ningún estado: que el fletero tiene que confirmar, cuándo
  se paga el saldo y qué pasa si la seña no se acredita.

**Propuesta.** El back_url ya trae `tripId`, `cargoItemId` y `type`
(`server/lib/mercadopago.ts:175`). Con eso la página consulta el estado real del pago, con
polling cada 3 s durante unos 60 s, y muestra el resultado del server, no el de la URL:
| Estado real | Título | Texto | CTA |
|---|---|---|---|
| verificando (≤60 s) | Estamos verificando tu pago | Mercado Pago nos avisa en unos segundos. No cierres esta pestaña ni pagues de nuevo. | — (spinner) |
| seña APPROVED | Seña acreditada | Reservaste 4 m³ en Rosario → Mendoza. Ahora el fletero tiene que confirmar tu carga; te avisamos por mail. El saldo de $ 192 se paga cuando el viaje sale. | Ver mi carga |
| saldo APPROVED | Saldo pagado | Ya está todo pago. Podés seguir el viaje desde el detalle. | Seguir el viaje |
| sigue PENDING a los 60 s | Tu pago todavía no se acreditó | A veces Mercado Pago tarda unos minutos. Te avisamos por mail apenas se acredite. No hace falta pagar de nuevo. | Volver al viaje |
| REJECTED | Mercado Pago rechazó el pago | No se cobró nada. Tu lugar sigue reservado hasta el {fecha hora}; podés intentar con otro medio. | Reintentar pago |

### 1.2 Vencimiento a 24 h y penalidad antes de cancelar
- **El vencimiento de 24 h no aparece en ninguna parte del cliente.** Un grep de
  `24 h|vence|expira` en `client/src` solo encuentra la política de retiro en `PublishTrip`.
  - La fila de la reserva dice "seña de $ 48,00 para reservar el lugar · quedan $ 192,00 al
    salir" ([captura](./screens/13-empresa-pagar-sena-error-desktop.png)), pero no dice hasta
    cuándo está reservado.
  - "Mis cargas" en el perfil dice "seña de $ 48,00 pendiente"
    ([captura](./screens/15-empresa-perfil-desktop.png)).
  - Tampoco el formulario de reserva avisa antes de reservar.
- **La penalidad sí aparece antes de cancelar**, pero mal:
  - es un `window.confirm` nativo (`pages/TripDetail.tsx:78-98`) con la quote del server;
  - el signo de apertura está roto ("**?**retirar esta carga?", líneas 80-92);
  - con la seña **sin pagar** dice "te devolvemos $ 48,00 de la seña": la quote no mira si la
    seña se pagó, así que promete un reembolso de algo que nunca se cobró;
  - en mobile el confirm nativo tapa todo el contexto;
  - la empresa nunca ve la política de retiro **antes de reservar**: solo la ve el fletero en
    el formulario de publicar ([captura](./screens/24-fletero-publicar-completo-desktop.png)).
- **Propuesta**:
  - En la fila de la reserva PENDING sin seña: "Reservado hasta el mar 4/11 a las 23:52. Si no
    pagás la seña antes, el lugar se libera." Faltando menos de 3 h, el texto pasa a color
    `danger`.
  - Debajo del botón "sumar carga": "Reservás el lugar por 24 h. Para confirmarlo pagás una
    seña del 20 % ($ 48). Si retirás la carga: más de 48 h antes de la salida te devolvemos
    toda la seña, entre 24 y 48 h la mitad, con menos de 24 h no hay devolución."
  - Reemplazar el confirm nativo por un diálogo propio con desglose:
    - con seña sin pagar: "Retirar esta carga. Liberás 4 m³. Todavía no pagaste la seña, así
      que no hay nada que devolver.";
    - con seña pagada: "Retirar esta carga. Seña pagada: $ 48. Te devolvemos: $ 24 (faltan
      30 h para la salida, se retiene la mitad). El reembolso tarda hasta 10 días hábiles en
      Mercado Pago." Botones: "Retirar carga" (danger) y "Mantener".

### 1.3 Seña vs saldo: qué es cada uno y cuándo se paga
- **Lo bueno**: la fila con seña pendiente distingue bien los dos montos ("seña de $ 48,00 para
  reservar el lugar · quedan $ 192,00 al salir"), y al salir aparece "saldo de $ X pendiente"
  con su propio botón.
- **Lo que confunde**:
  1. El **precio grande del viaje** ($ 1.800,00 en el detalle; $ 500.000,00 en el listado) es
     el precio del camión entero. La empresa paga por m³ y ese precio no aparece en ningún
     lado ([listado](./screens/03-viajes-desktop.png)).
  2. El formulario de reserva **no anticipa cuánto se va a pagar**: el precio, la seña y el
     saldo recién aparecen después de reservar
     ([form](./screens/11-empresa-reservar-completo-desktop.png)).
  3. Después de pagar la seña, la fila solo muestra el chip "seña pagada" y el saldo
     desaparece hasta IN_TRANSIT. La empresa pierde de vista que todavía le falta pagar.
  4. "Mis cargas" muestra viajes **completados con carga confirmada y "seña de $ 480,00
     pendiente"** ([perfil](./screens/15-empresa-perfil-desktop.png)). Es un estado
     imposible, que sale de datos inconsistentes de la base o de pagos que nunca se
     acreditaron (02 #5).
- **Propuesta**: una línea de tiempo de pago fija en cada fila de carga y en "mis cargas":
  `Reserva → Seña $ 48 (hasta 4/11 23:52) → Confirmación del fletero → Salida 1/12 → Saldo $ 192`,
  con el paso actual resaltado. En el listado y el detalle: "$ 60 por m³ · 23 m³ libres" como
  dato principal, y el precio del camión como dato secundario. En el formulario, antes del
  botón: "4 m³ × $ 60 = $ 240. Hoy pagás la seña de $ 48; el saldo de $ 192 se paga cuando el
  viaje sale."

### 1.4 ¿El fletero entiende que tiene que confirmar antes de salir?
**No.**
- Sin seña aprobada, las cargas aparecen como "pendiente" **sin ninguna acción ni
  explicación** ([captura](./screens/26-fletero-detalle-viaje-desktop.png)). El botón
  "confirmar carga" solo existe si la seña está APPROVED (`pages/TripDetail.tsx:642-655`).
- Con la seña aprobada (simulado) aparece "confirmar carga"
  ([captura](./screens/29-fletero-confirmar-carga-desktop.png)), pero nada dice que hay que
  hacerlo antes de salir ni qué pasa si no se hace.
- Justo arriba, "este es tu viaje · marcalo como en viaje cuando salgas" con el botón
  "**marcar en tránsito**", que se ejecuta **con un solo clic, sin diálogo y sin avisar que hay
  2 cargas pendientes** (`pages/TripDetail.tsx:464-480`;
  [antes](./screens/32-fletero-marcar-transito-antes-desktop.png) →
  [después](./screens/33-fletero-en-transito-desktop.png)).
  - Después del cambio, las dos cargas siguen "pendiente", ya no se pueden retirar y el
    diagrama sigue diciendo "el 77 % que queda libre se sigue pudiendo ofertar". Esto
    reproduce en la UI el fraude/accidente de 02 TOP #8.
- Además, `canConfirm` deja confirmar a la **empresa dueña** de la carga
  (`pages/TripDetail.tsx:242-244`), y `/pagos/retorno` le dice a la empresa "ya podés
  confirmar la carga". Los roles quedan mezclados.
- **Propuesta**:
  - Encabezar la sección de cargas del fletero con un checklist de salida: "Antes de salir:
    confirmá las cargas con seña pagada (1 de 2). Las cargas sin seña se cancelan solas cuando
    marcás el viaje en tránsito."
  - "marcar en tránsito" abre un diálogo:
    - Título: "¿Salís ahora?"
    - Texto: "Vas a llevar 1 carga confirmada (4 m³). Hay 1 carga sin confirmar: si salís, se
      cancela y le devolvemos la seña a la empresa. Las empresas confirmadas van a recibir el
      aviso para pagar el saldo."
    - Botones: "Salir con 1 carga" y "Volver".
  - En cada carga PENDING sin seña: "Esperando la seña de la empresa (vence 4/11 23:52)".
  - El botón "confirmar carga" solo para el fletero.

### 1.5 Datos de otras empresas en TripDetail y paradas (02 TOP #6 y §2.7)
Visto en la UI **sin sesión**:
[con cargas](./screens/05-viaje-detalle-anonimo-con-cargas-desktop.png),
[en tránsito](./screens/05-viaje-en-transito-anonimo-desktop.png).

`pages/TripDetail.tsx:515-600` renderiza **todas** las cargas para cualquier visitante, sin
mirar `isCompany`.

| Dato | Anónimo | Otra empresa con carga | ¿Debería verse? |
|---|---|---|---|
| Descripción de la mercadería ("8 pallets de cerámicos", "Bobinas de acero") — en la lista **y como etiqueta del diagrama de ocupación** | ✅ se ve | ✅ | **No.** Solo la propia; a terceros, "otra carga · 4 m³" |
| Dirección exacta de retiro ("retiro: Bv. Oroño 1200, Rosario") | ✅ | ✅ (también en "paradas de retiro") | **No.** Ni anónimos ni otras empresas |
| Pin exacto de retiro en el mapa "recorrido del viaje" (`/route` público) | ✅ (pines 2 y 3) | ✅ | **No.** A terceros, a lo sumo la ciudad |
| Código de seguimiento (`TP-IF70-C1`) | ✅ | ✅ | **No.** Con el código, `/rastrear` muestra mercadería, estado y fecha (02 #16) |
| Monto de la carga ("$ 240,00 del viaje") | ✅ | ✅ | **No.** Espionaje comercial |
| Estado de la carga (pendiente/confirmada) | ✅ | ✅ | Solo agregado ("2 cargas, 7 m³") |
| Ocupación total y cantidad de empresas | ✅ | ✅ | Sí |

Además, la pantalla de error de `/rastrear` le enseña el formato a quien quiera enumerar:
"Verificá que lo hayas copiado bien (formato: TP-XXXX-C#)"
([captura](./screens/06-rastrear-invalido-desktop.png)).

**Propuesta de UI** (acompaña el DTO por whitelist de 02):
- terceros ven una barra de ocupación sin nombres y la línea "Ya hay 2 cargas en este viaje
  (7 m³). Quedan 23 m³ libres.";
- en la lista, la carga propia completa y las ajenas como "Otra carga · 3 m³ · retiro en
  Rosario", sin código, monto ni dirección;
- el fletero ve todo.

---

## 2. Problemas por pantalla
Prioridad: **P1** rompe la tarea o engaña al usuario · **P2** confunde o es inconsistente ·
**P3** pulido.

### Landing `/`
[desktop](./screens/01-landing-desktop.png) · [mobile](./screens/01-landing-mobile.png) ·
[foco](./screens/60-foco-landing-desktop.png)
1. **P1 — El copy contradice el producto.**
   - "EMPRESAS: PUBLICAR CARGA" (`components/landing/Hero.tsx:37`): la empresa no publica,
     reserva espacio en viajes publicados.
   - "Negocia tarifas, acepta ofertas": el precio es fijo por m³.
   - "MVP: … Próximamente: Chat, Pagos, IA" (`components/landing/Benefits.tsx:57`): los pagos y
     el chat ya existen.
   - **Propuesta**: CTA de empresa "Buscar un viaje para mi carga", CTA de fletero "Publicar mi
     viaje", paso 3 "Reservá y pagá la seña". Borrar la línea MVP.
2. **P2 — ALL CAPS y tuteo mezclado con voseo.** Todos los títulos y labels van en mayúsculas,
   y se mezclan "Conecta", "Reduce", "Accede" con "Publicá", "Conectás". **Propuesta**:
   oraciones en minúscula inicial con Space Grotesk, voseo en todo el copy.
3. **P2 — La misma elección se repite tres veces** (CTA del hero, tarjetas
   empresa/transportista y CTA de cierre), y el hero no muestra el producto. **Propuesta**:
   mostrar en el hero un viaje real del listado con su diagrama de ocupación ("Rosario →
   Mendoza · quedan 23 m³") y un único CTA por rol.
4. **P3 — Testimonios ficticios con disclaimer** y footer "Desarrollado como proyecto
   full-stack profesional". En un marketplace de pagos le restan confianza. **Propuesta**:
   sacar los testimonios hasta que haya reseñas reales (ya existen las reviews de viajes
   completados).
5. **P3 — Mobile**: muestra la campanita de notificaciones a un visitante anónimo. Los dots del
   carrusel miden 10×10 px y los íconos del header 38–40 px (menos de 44).

### Ingresar `/ingresar`
[desktop](./screens/02-ingresar-desktop.png) · [mobile](./screens/02-ingresar-mobile.png) ·
[error local](./screens/02-ingresar-error-desktop.png) ·
[error del server](./screens/02-ingresar-error-servidor-desktop.png)
1. **P2 — El login valida longitud mínima**: con una contraseña de 4 caracteres responde "la
   contraseña debe tener al menos 8 caracteres." (`pages/Login.tsx:44`). Es una regla de
   registro aplicada al login. **Propuesta**: en modo acceder, validar solo que no esté vacía.
   El error del server ya es correcto: "email o contraseña incorrectos".
2. **P2 — Falta "¿Olvidaste tu contraseña?"** y no hay forma de mostrar la contraseña. En
   mobile pesa más.
3. **P3 — Faltan `autocomplete="email"` y `"current-password"`/`"new-password"`** (Chrome lo
   advierte en consola). Rompe el autocompletado de los gestores de contraseñas.
4. **P3 — El foco es el outline por defecto del navegador** (1 px negro,
   [captura](./screens/60-foco-ingresar-desktop.png)). Funciona, pero no usa el anillo
   `accent-strong` de `Button`. Unificar.

### Listado `/viajes`
[desktop](./screens/03-viajes-desktop.png) · [mobile](./screens/03-viajes-mobile.png) ·
[vacío (sim)](./screens/51-viajes-vacio-sim-desktop.png) ·
[error (sim)](./screens/51-viajes-error-sim-desktop.png) ·
[cargando (sim)](./screens/51-viajes-cargando-sim-desktop.png)
1. **P1 — La empresa no ve lo que va a pagar.** La tarjeta muestra el precio del camión
   entero, y "0.0 / 30.0 m³ ocupados" obliga a hacer la cuenta. **Propuesta**: "$ 60 / m³ ·
   **30 m³ libres**" como dato principal y el precio total chico.
2. **P2 — Los filtros ocupan el primer pantallazo**: cinco checkboxes y cuatro campos antes del
   primer viaje; en mobile, el primer viaje queda debajo del fold. **Propuesta**: buscador
   compacto origen/destino/fecha y el resto en "Más filtros".
3. **P2 — Copy**: "Ventana de viajes" no dice nada. **Propuesta**: "Viajes con lugar libre".
   Las fechas vienen sin día de la semana ("1/12/2026"). **Propuesta**: "lun 1 dic".
4. **P2 — El estado de error es texto plano sin acción**: "no pudimos cargar los viajes. probá
   de nuevo en un rato." **Propuesta**: botón "Reintentar". El vacío está bien ("todavía no hay
   viajes publicados." + CTA según el rol) y la carga usa skeleton.
5. **P3 — Las tarjetas son todas iguales**, con el mismo CTA azul a lo ancho. **Propuesta**:
   que la tarjeta entera sea el link y el CTA un texto. Usar el mini diagrama de ocupación como
   elemento visual de la tarjeta.

### Detalle del viaje (empresa) `/viajes/:id`
[sin sesión](./screens/05-viaje-detalle-anonimo-desktop.png) ·
[empresa](./screens/10-empresa-detalle-desktop.png) ·
[mobile](./screens/10-empresa-detalle-mobile.png) ·
[reserva creada](./screens/12-empresa-reserva-creada-desktop.png) ·
[fila mobile](./screens/12-empresa-reserva-fila-mobile.png) ·
[error (sim)](./screens/52-detalle-error-sim-desktop.png)
1. **P1 — Expone datos de otras empresas** (ver §1.5).
2. **P1 — "paradas de retiro" para quien no participa**: el endpoint devuelve 403 y TanStack
   reintenta varias veces. Se ve un skeleton varios segundos y después "no pudimos cargar las
   paradas.". Ese error **sigue ahí después de reservar**, aunque la empresa ya es participante
   ([captura](./screens/12-empresa-reserva-creada-desktop.png)). **Propuesta**: no mostrar la
   sección a no participantes, `retry: false` en 401/403/404 e invalidar `stops` al reservar
   (`components/TripStops.tsx:111,175`; `hooks/useTripStops.ts`).
3. **P1 — El formulario de reserva no informa precio, seña, vencimiento ni política** (§1.2 y
   §1.3). Además deja errores viejos: "contanos qué querés mandar." sigue visible con el campo
   ya completo, junto a "buscando la dirección…"
   ([captura](./screens/11-empresa-reservar-completo-desktop.png)). **Propuesta**: resumen en
   vivo arriba del botón y limpiar el error al editar.
4. **P2 — Jerarquía**: el formulario para sumar carga, que es la acción principal de la
   empresa, está al final, debajo del mapa y los mensajes. **Propuesta**: en desktop, dos
   columnas, con un panel fijo a la derecha "Tu carga en este viaje" (reservar o, si ya
   reservó, la línea de tiempo de pago). En mobile, botón fijo abajo "Sumar carga · desde
   $ 60/m³".
5. **P2 — Copy y estados**:
   - "una empresa comparten este viaje." (`components/CargoFillDiagram.tsx:97`);
   - "el X % que queda libre se sigue pudiendo ofertar" también en viajes en tránsito o
     vencidos (línea 98);
   - en un viaje **"abierto" con fecha pasada**, el badge dice abierto y el formulario dice
     "este viaje ya comenzó" ([A → B](./screens/53-viaje-mal-geocodificado-desktop.png));
   - el título de la pestaña dice "Viajes abiertos";
   - 404 y 500 muestran lo mismo, "no pudimos cargar este viaje.", sin link de vuelta
     (`pages/TripDetail.tsx:221-225`);
   - en mobile, la fila de la carga aprieta el texto en una columna angosta con dos acciones al
     lado. Apilar las acciones debajo.

### Pagar seña
[error](./screens/13-empresa-pagar-sena-error-desktop.png) ·
[retirar (confirm nativo)](./screens/14-empresa-retirar-carga-desktop.png)
1. **P1 — La empresa puede reservar en un viaje que no puede cobrar.** El error llega recién al
   pagar: "el transportista de este viaje no tiene cuenta de Mercado Pago conectada". La
   empresa no puede hacer nada con eso y el lugar queda tomado 24 h. **Propuesta**: no listar
   ni dejar reservar viajes de fleteros sin MP (es un filtro de server). Si el fletero se
   desconecta después: "Este viaje no puede recibir pagos por ahora. Le avisamos al fletero.
   Tu lugar queda reservado hasta {fecha}."
2. **P2 — El error queda lejos del botón**: aparece debajo de la tarjeta, en rojo chico, y el
   botón "pagar seña" sigue igual de prominente. **Propuesta**: mostrar el error dentro de la
   fila y deshabilitar el botón con el motivo.
3. **P2 — "retirar carga" es texto suelto sin estilo de botón** al lado de un CTA naranja. Se
   lee como un label. **Propuesta**: botón `outline` en `danger` y diálogo propio (§1.2).

### Publicar viaje (fletero) `/viajes/nuevo`
[sin MP](./screens/20-fletero-tras-login-desktop.png) ·
[mobile](./screens/20-fletero-tras-login-mobile.png) ·
[form (sim)](./screens/23-fletero-publicar-vacio-desktop.png) ·
[completo (sim)](./screens/24-fletero-publicar-completo-desktop.png) ·
[mobile (sim)](./screens/24-fletero-publicar-completo-mobile.png) ·
[submit](./screens/25-fletero-publicar-submit-desktop.png)
1. **P1 — "Córdoba" se geocodifica como Córdoba, España**: el pin queda en 37.88, -4.77 y la
   ruta tiene **10.412 km**. El precio sugerido ($ 4.954.600) **pisa el precio que escribió el
   fletero** ($ 900.000), y el slider queda limitado a ±15 % de esa sugerencia
   (`pages/PublishTrip.tsx:108-140`). Con un geocode malo, no se puede publicar el precio real.
   En la base hay viajes reales con este problema (`cmuj8caaz…`, "A → B" en Europa).
   - **Propuesta**:
     - limitar el geocoding a Argentina (`countrycodes=ar`, es del server);
     - mostrar el lugar resuelto en texto, no en coordenadas: "Córdoba, Córdoba, Argentina ✓"
       o "Córdoba, Andalucía, **España** — ¿es correcto?";
     - si la distancia es absurda (más de 5.000 km), no sugerir precio;
     - el precio es siempre editable, con la sugerencia como referencia: "sugerido $ 1.250.000
       (±15 %)".
2. **P1 — Sin MP conectado, el formulario desaparece por completo**: solo queda una tarjeta.
   Además, el error de conectar le muestra al fletero el nombre de una variable de entorno:
   "no pudimos iniciar la conexión: Mercado Pago Marketplace no está configurado: falta
   MP_CLIENT_ID" ([captura](./screens/22-fletero-conectar-mp-error-desktop.png)).
   - **Propuesta**: mostrar el formulario con un checklist arriba ("Para publicar: ✓ Identidad
     verificada · ✗ Cuenta de Mercado Pago") y bloquear solo el botón final.
   - Para `MP_NOT_CONFIGURED`: "La conexión con Mercado Pago no está disponible en este
     momento. Probá más tarde o escribinos."
3. **P2 — La grilla de 4 columnas corta los datos**: la fecha se ve "12/15/20:" y la hora
   "06:30 A". El monto del slider ("$ 4.954.600,00") se sale de la tarjeta. **Propuesta**:
   2 columnas (fecha y hora / vehículo y capacidad) y el monto debajo del slider.
4. **P2 — Copy técnico**: "pin del origen: 37.8846, -4.7760 — revisá que sea el lugar
   correcto", y "revisá los pines… el pin de salida es el azul", cuando hay tres colores en el
   mapa. **Propuesta**: la leyenda dentro del mapa, con nombre y no color.
5. **P3 — Lo bueno, a conservar**: la política de seña y retiro está explicada justo debajo del
   porcentaje de seña, y todos los campos tienen label.

### Paradas (reordenar)
[antes](./screens/27-fletero-paradas-antes-desktop.png) ·
[foco en handle](./screens/27-fletero-paradas-foco-handle-desktop.png) ·
[arrastrando](./screens/27-fletero-paradas-arrastrando-desktop.png) ·
[después](./screens/28-fletero-paradas-despues-desktop.png)
1. **P2 — Los anuncios de lector de pantalla salen en inglés y con ids**: "Draggable item
   cmw03ebx8… was dropped over droppable area cmw03aetq…". **Propuesta**: prop
   `accessibility.announcements` del `DndContext` (`components/TripStops.tsx:194`) en español:
   "Parada San Martín 500 movida al lugar 2 de 2."
2. **P2 — La numeración del mapa no coincide con la lista**: el mapa numera 1–4 (salida,
   paradas, llegada) y la lista 1–2, y dos paradas en la misma ciudad se tapan. **Propuesta**:
   salida y llegada con ícono propio (camión/bandera) y números solo para las paradas, igual
   que en la lista.
3. **P3 — Lo bueno**: el handle tiene `aria-label="mover {dirección}"`, el reorden por teclado
   (Espacio, flechas, Espacio) funciona y guarda (200), y la instrucción "arrastrá los ítems…
   el cambio se guarda al soltar" es clara. Falta una confirmación visual del guardado
   ("Orden guardado").
4. **P3 — Se puede reordenar con el viaje ya en tránsito**
   ([captura](./screens/33-fletero-en-transito-desktop.png)). Decidir si es intencional; si lo
   es, avisar que las empresas ven el cambio.

### Solicitudes `/solicitudes`
[desktop](./screens/30-fletero-solicitudes-desktop.png) ·
[mobile](./screens/30-fletero-solicitudes-mobile.png) ·
[aceptar](./screens/31-fletero-solicitud-aceptar-form-desktop.png) ·
[aceptar mobile](./screens/31-fletero-solicitud-aceptar-form-mobile.png)
1. **P1 — Se pueden aceptar solicitudes con fecha pasada**: la del 1/10/2026 sigue
   "pendiente", con "aceptar" activo. **Propuesta**: marcarlas "vencida" y sacarles las
   acciones.
2. **P2 — El modal "aceptar" no es accesible ni entra en mobile**: no tiene `role="dialog"`,
   Escape no lo cierra y el foco queda en el botón de atrás (`pages/TripRequests.tsx:636`). A
   390 px desborda: la página pasa a 455 px de ancho y el título queda cortado arriba. **Propuesta**: usar el
   mismo componente de diálogo que el resto (o `<dialog>`), con foco en el primer campo.
3. **P2 — Es inconsistente con Publicar**: no tiene mapa, precio sugerido ni explicación de la
   seña, y los extras están en Title Case ("Refrigeración", "Seguro") en vez de minúscula. Es
   un segundo formulario de publicación peor que el primero. Además, por este camino se saltea
   la verificación de identidad (02 TOP #2). **Propuesta**: "aceptar" lleva a `/viajes/nuevo`
   precargado con origen, destino, fecha y volumen.
4. **P3 — El chip "pendiente" parece un botón** (mismo alto y radio que "aceptar").
   **Propuesta**: el estado como texto de color sobre la tarjeta, no como pill al lado de los
   botones.

### Confirmar carga y cambiar estado
Cubierto en §1.4:
[confirmar (sim)](./screens/29-fletero-confirmar-carga-desktop.png) ·
[mobile](./screens/29-fletero-confirmar-carga-mobile.png) ·
[en tránsito](./screens/33-fletero-en-transito-desktop.png) ·
[mobile](./screens/33-fletero-en-transito-mobile.png).
1. **P1 — "marcar en tránsito" sin confirmación ni aviso de las cargas pendientes**:
   irreversible, de un clic.
2. **P1 — "confirmar carga" aparece o desaparece sin explicar por qué.**
3. **P2 — "este es tu viaje" + "marcar en tránsito"** está entre el mapa y las cargas, sin
   jerarquía de "próximo paso". **Propuesta**: barra de estado del viaje arriba de todo
   (Abierto → En viaje → Completado) con el próximo paso y sus requisitos.
4. **P2 — El fletero ve "sumar carga a este viaje · necesitás una cuenta de empresa: crear
   cuenta de empresa"** en su propio viaje. **Propuesta**: no mostrarle esa sección al dueño.

### Rastrear `/rastrear`
[vacío](./screens/06-rastrear-desktop.png) · [mobile](./screens/06-rastrear-mobile.png) ·
[válido](./screens/06-rastrear-valido-desktop.png) ·
[válido mobile](./screens/06-rastrear-valido-mobile.png) ·
[inválido](./screens/06-rastrear-invalido-desktop.png) ·
[inválido mobile](./screens/06-rastrear-invalido-mobile.png)
1. **P1 — Un código inexistente tarda ~8,5 s** de skeleton antes de decir "Código no
   encontrado" (reintentos sobre un 404). **Propuesta**: `retry: false` para 404 en
   `usePublicTracking`.
2. **P2 — El botón queda en "buscando…"** (deshabilitado) aunque el resultado ya se muestra.
3. **P2 — El error enseña el formato del código** ("formato: TP-XXXX-C#") y el detalle público
   del viaje muestra los códigos de todos (§1.5). **Propuesta**: "No encontramos ese código.
   Revisá el mail de confirmación de tu reserva."
4. **P3 — Mezcla de mayúsculas**: "Pendiente de confirmar", "Abierto a cargas", "Buscar otro
   código" (en Title/Sentence case) conviven con el resto del producto en minúscula. Además,
   "← volver al inicio" se parte en dos líneas en desktop. El aviso "este es un seguimiento
   público: no muestra direcciones exactas…" está bien y conviene mantenerlo.

### Retorno de pago `/pagos/retorno`
Cubierto en §1.1. Además:
1. **P2 — El mismo par de botones para todos los estados**. Con rechazo, el CTA principal
   tendría que ser "Reintentar pago". Con approved, "Ver mi carga".
2. **P3 — `pending` no tiene ícono** (approved tiene ✓ y rejected ✗). Usar un reloj, o un
   spinner mientras se verifica.

### Admin `/admin/verificaciones`
[real (vacío)](./screens/40-admin-verificaciones-desktop.png) ·
[mobile](./screens/40-admin-verificaciones-mobile.png) ·
[con datos (sim)](./screens/41-admin-verificaciones-con-datos-sim-desktop.png) ·
[mobile (sim)](./screens/41-admin-verificaciones-con-datos-sim-mobile.png) ·
[error (sim)](./screens/41-admin-verificaciones-error-sim-desktop.png) ·
[cargando (sim)](./screens/41-admin-verificaciones-cargando-sim-desktop.png)
1. **P1 — Se puede aprobar sin datos**: con "dni/cuit: no informado", "aprobar" está activo y
   es el botón naranja principal. El subtítulo dice "revisá el DNI o CUIT", pero no hay
   documento que revisar (02 §2.2). **Propuesta**:
   - deshabilitar "aprobar" si no hay CUIT, con la nota "Sin CUIT no se puede aprobar";
   - mostrar el CUIT formateado y validado ("dígito verificador ✓/✗");
   - "aprobar" como botón neutro y confirmación "¿Aprobar a Fletes Ruta 9? Va a poder publicar
     viajes y cobrar señas."
2. **P2 — El error del query no se muestra**: con un 500, la página queda en blanco debajo del
   subtítulo (`pages/AdminVerifications.tsx:58-72` no usa `verifications.isError`).
   **Propuesta**: "No pudimos cargar las verificaciones." + "Reintentar".
3. **P2 — El admin no tiene entrada en la navegación**: después del login cae en `/viajes`, con
   el mismo menú que un visitante. **Propuesta**: link "Verificaciones (2)" en el header para
   ADMIN y que el login lo lleve a `/admin`.
4. **P3 — "enviada el"** muestra la fecha de alta del usuario, no la del pedido (02 §2.2).

### Viajes sin coordenadas
[desktop](./screens/50-viaje-sin-coordenadas-desktop.png) ·
[mobile](./screens/50-viaje-sin-coordenadas-mobile.png) ·
[en tránsito sin ubicación de retiro](./screens/05-viaje-en-transito-anonimo-desktop.png)
1. **Bien resuelto**: "este viaje todavía no tiene puntos en el mapa." en un placeholder del
   alto del mapa, y "hay paradas sin ubicación confirmada, así que el recorrido puede no
   reflejar el orden real." cuando falta alguna parada. **Ajuste de copy**: "Todavía no podemos
   mostrar este recorrido en el mapa."
2. **P1 — Lo peligroso no es la falta de coordenadas, son las coordenadas equivocadas**
   (Córdoba → España, "A → B" en Europa:
   [desktop](./screens/53-viaje-mal-geocodificado-desktop.png) ·
   [mobile](./screens/53-viaje-mal-geocodificado-mobile.png)). Un viaje sin coordenadas avisa; uno mal geocodificado
   miente con seguridad. Ver Publicar #1.
3. **P2 — En viajes sin coordenadas, "paradas de retiro" queda en skeleton** para no
   participantes (mismo bug que el detalle #2).
4. **P3 — "Dirección de retiro pendiente (editar en el viaje)"** aparece como dirección real en
   cargas viejas, pero en la UI no hay forma de editarla.

---

## 3. Transversales

### Accesibilidad
- **Contraste** (WCAG, calculado sobre los tokens de `index.css`):
  | Par | Ratio | AA texto chico |
  |---|---|---|
  | `ink-muted` sobre `canvas` (texto secundario en el fondo) | 4.55 | ✅ (justo) |
  | `ink-muted` sobre `canvas-line` (badge "pendiente") | **3.89** | ❌ |
  | `ink-muted` sobre `brand-deep` (copyright del footer) | **2.72** | ❌ |
  | `accent-strong` sobre blanco (texto naranja chico) | **4.25** | ❌ (usar `accent-text`) |
  | blanco sobre `accent` | 2.59 | ❌ — hoy no se usa: los botones naranjas llevan texto oscuro (5.57–5.86) ✅ |
  | `line-strong` (borde de input) sobre blanco | **1.35** | ❌ (para componentes se pide ≥3:1) |
  | `line` (borde de tarjeta) sobre `canvas` | 1.10 | decorativo, pero las tarjetas "flotan" sin borde visible |
- **Labels**: todos los inputs de login, reserva, publicar y filtros tienen label asociado ✅.
  El textarea de mensajes tiene label "mensaje" ✅.
- **Foco**: solo `Button` y `.checkbox` definen un anillo propio (`outline accent-strong`).
  Links, tabs y el resto usan el outline por defecto (1 px). **Propuesta**: regla global
  `:focus-visible { outline: 2px solid var(--color-accent-strong); outline-offset: 2px }`.
- **Diálogos**: el retiro usa `window.confirm` y el modal de solicitudes no es un dialog (ver
  arriba).
- **Targets táctiles < 44 px**: íconos del header (38–40), dots del carrusel (10×10), marcadores
  del mapa (24), zoom de Leaflet (30), links del footer (20 de alto).

### Responsive
- **No hay scroll horizontal** en las pantallas a 390 px ✅, **salvo con el modal de "aceptar
  solicitud" abierto**: la página pasa a medir 455 px de ancho y el título del modal queda
  cortado bajo el header
  ([captura](./screens/31-fletero-solicitud-aceptar-form-mobile.png)).
- Otros problemas: la fila de carga apretada en el detalle; la grilla de 4 columnas de
  publicar (la fecha y la hora se cortan también en desktop); los filtros de `/viajes` empujan
  el listado debajo del fold.

### Consistencia con `index.css`
- La paleta se respeta: `brand` navy para estructura, `accent` naranja para CTA, `canvas` de
  fondo. Pero **el naranja se usa para todo**: "Registrarse", "sumar carga", "pagar seña",
  "aceptar", "aprobar", "enviar", "conectar MP". En el detalle de la empresa conviven tres
  botones naranjas. Se pierde la señal de "esta es LA acción".
- **Tipografía sin una regla de mayúsculas**: ALL CAPS en la landing, Title Case en
  `/rastrear` y en los extras de solicitudes, minúscula en el resto de la app y en los
  mensajes de error. Los títulos h1 ("Publicar un viaje", "Tu perfil") empiezan en mayúscula,
  pero los h2 no ("paradas de retiro").
- Se mezclan estilos de chip: `rounded-full` para estados, rectángulos para extras, pills
  `brand` sólidos para "seña pagada".

---

## 4. Dirección visual
- **El camión como firma.** El diagrama de ocupación (`CargoFillDiagram`) es lo más propio del
  producto: una caja que se llena. Conviene usarlo en todos lados (hero de la landing con un
  viaje real, tarjetas del listado, detalle, "mis cargas") y que sea lo único "audaz". Lo
  demás, sobrio: blanco, navy y líneas finas.
- **El dinero como línea de tiempo, no como texto suelto.** Un componente único
  `Reserva → Seña → Confirmación → Salida → Saldo`, con fechas y montos, en la fila de la
  carga, en `/pagos/retorno`, en "mis cargas" y en los mails. La misma secuencia para la
  empresa y el fletero; cambia solo quién tiene la próxima acción.
- **Un solo naranja por pantalla.** `accent` queda para la próxima acción del usuario (y para
  plata pendiente). Las acciones secundarias van en `outline` navy; las destructivas, en
  `outline` `danger`. Los estados de pago con una escala fija: pendiente (neutro), acreditado
  (`success`), vencido o rechazado (`danger`), en proceso (`brand-light`).
- **Sentence case y voseo en todo.** Space Grotesk para títulos en minúscula con mayúscula
  inicial (adiós ALL CAPS), Inter para el cuerpo. El mismo verbo de punta a punta: el botón
  "Sumar carga" produce el toast "Carga sumada" y la fila "Tu carga"; "Retirar carga" produce
  "Carga retirada".
- **El detalle como hoja de ruta.** Desktop en dos columnas: a la izquierda el recorrido (mapa
  + paradas + estado del viaje como barra de progreso); a la derecha un panel fijo "Tu carga"
  (empresa) o "Antes de salir" (fletero) con el checklist y la próxima acción. En mobile, ese
  panel pasa a una barra fija abajo.

## 5. Quick wins (< 1 h cada uno)
| # | Cambio | Archivo |
|---|---|---|
| 1 | "?retirar" → "¿Retirar…?" en los 4 mensajes de cancelación | `pages/TripDetail.tsx:80-92` |
| 2 | "una empresa comparten" → "una empresa comparte"; ocultar "se sigue pudiendo ofertar" si el viaje no está OPEN | `components/CargoFillDiagram.tsx:97-98` |
| 3 | No validar longitud de contraseña en modo "acceder"; agregar `autocomplete` | `pages/Login.tsx:44` |
| 4 | Copy de approved sin "ya podés confirmar la carga"; CTA "Reintentar pago" en rejected; ícono en pending | `pages/PaymentReturn.tsx` |
| 5 | Sacar "MVP… Próximamente: Chat, Pagos, IA" y corregir los CTA "PUBLICAR CARGA" | `components/landing/Benefits.tsx:57`, `Hero.tsx:37`, `ClosingCta.tsx` |
| 6 | `retry: false` en 401/403/404 para paradas y tracking público; no mostrar "paradas de retiro" a no participantes; invalidar `stops` al reservar | `hooks/useTripStops.ts`, `components/TripStops.tsx:111,175`, `hooks/useAddCargoItem.ts` |
| 7 | Mostrar `verifications.isError` con "Reintentar" | `pages/AdminVerifications.tsx:58-72` |
| 8 | 404 vs error en el detalle ("Este viaje no existe o ya no está publicado" + link a /viajes); título de pestaña con origen → destino | `pages/TripDetail.tsx:221-225` |
| 9 | Confirm provisorio en "marcar en tránsito" con la cantidad de cargas pendientes (hasta tener el diálogo) | `pages/TripDetail.tsx:474-478` |
| 10 | `accessibility.announcements` del DndContext en español y sin ids | `components/TripStops.tsx:194` |
| 11 | Traducir `MP_NOT_CONFIGURED` a copy de usuario (no mostrar el nombre de la variable de entorno) | `hooks/useConnectMp.ts` / `pages/Profile.tsx` |
| 12 | Línea "Reservado hasta {createdAt + 24 h}" en la fila PENDING sin seña | `pages/TripDetail.tsx` (bloque `showDepositPayButton`) |
| 13 | Fila de carga en mobile: `flex-col sm:flex-row` y acciones debajo | `pages/TripDetail.tsx:541-544` |
| 14 | `/rastrear`: volver el botón a "buscar" al terminar; sacar "formato: TP-XXXX-C#" | `pages/TrackPackage.tsx` |
| 15 | Contraste: copyright del footer a `brand-light`, badge "pendiente" con `ink-soft`, borde de input a `ink-muted`/`line-dashed` | `components/Footer*`, `index.css` |
| 16 | `:focus-visible` global con `accent-strong` | `index.css` |
| 17 | No mostrar "sumar carga a este viaje" al fletero dueño; no mostrar la campanita a anónimos en mobile | `pages/TripDetail.tsx`, header |
| 18 | Marcar como "vencida" y sin acciones la solicitud con fecha pasada | `pages/TripRequests.tsx` |
