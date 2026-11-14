# Referencias: cómo generan confianza las páginas de logística
Relevamiento del 2026-11-13 para rehacer el hero de la landing (dirección A). Se miraron las
home con Playwright (1440×900, `es-AR`): primera pantalla, página completa y los títulos y
botones de cada una. Las capturas quedaron fuera del repo, porque son de terceros: este
documento describe patrones y no copia textos, imágenes ni marcas.

| Sitio | Qué es | Qué se miró |
|---|---|---|
| Mercado Libre | marketplace (AR) | home `mercadolibre.com.ar`. `envios.mercadolibre.com.ar` redirige a una nota de ayuda para vendedores, así que Mercado Envíos se tomó de esa nota y de la franja de beneficios de la home |
| Andreani | paquetería (AR) | home |
| OCA | paquetería y correo (AR) | home |
| Uber Freight | marketplace de cargas (EE. UU., en español) | home `/es-US` |
| Flexport | forwarder digital | home |
| uShip | marketplace de envíos: el usuario publica y los transportistas cotizan | home |
| Freightos | marketplace de fletes internacionales | home |

uShip y Freightos se sumaron porque son marketplaces de carga, con dos lados como TruckPool.

## 1. Lo que vimos, por sitio
**Mercado Libre.** El hero es un carrusel de promos. Lo que genera confianza está debajo: una
franja de tarjetas de beneficios con ícono, título corto, una línea y un link (envío gratis,
medios de pago, ubicación). «Compra protegida» es una garantía con nombre propio. El tono es
de vos y sentence case, salvo los banners promocionales. Prueba social: tiendas oficiales.

**Andreani.** Es el más cercano a lo que pide el pedido. El hero es una **tarjeta con pestañas**
(«Seguir envío» / «Cotizar envío») y un solo campo con botón, más una ilustración plana de
línea en los colores de la marca, con una persona mirando el celular y un pin de ubicación.
Debajo vienen cuatro accesos rápidos (hacer un envío, seguir, sucursal, preguntas
frecuentes), «¿qué necesitás enviar?» con tipos de envío y límites de peso, y un mapa de
Argentina con la red y tres números grandes. Cierra con **FAQ en acordeón** y un link a
todas las preguntas. Tono de vos, directo y de servicio. En el footer, los sellos
regulatorios (defensa del consumidor, Data Fiscal).

**OCA.** Carrusel con foto de stock (persona con notebook) y un panel con CTA. Debajo, tres
tarjetas con formularios (seguimiento, sucursales, códigos postales), productos destacados y
«Clientes que nos avalan» (logos). Es el caso menos logrado: hay mucho formulario en el
primer pantallazo y la foto no dice nada del rubro.

**Uber Freight.** Hero oscuro con título largo y un solo CTA («conectar con un experto»),
pensado para venta B2B. La confianza viene de una **fila de números de escala** (volumen
gestionado, envíos por año, transportistas) y de casos de clientes con nombre. Hay un banner
de prensa arriba de todo. El tono es corporativo y de usted.

**Flexport.** Hero sobre una foto propia (un buque) con título corto, bajada con un beneficio
medible y un campo de email + «pedir demo». Debajo, **una captura del producto real** como
prueba de que existe. Siguen logos de clientes («trusted by…»), servicios en tarjetas y
noticias del mercado.

**uShip.** Es el más parecido a TruckPool en modelo. El hero tiene título, bajada con la
promesa (cotizaciones reales, precio transparente antes de reservar) y un **buscador de dos
selects** (categoría y subcategoría) con el CTA principal; el CTA del otro lado del mercado
(«hacerse transportista») va como secundario con contorno. La imagen es una foto con
**tarjetas flotantes del producto** encima (ruta origen → destino, transportista con
estrellas). Debajo: categorías con íconos; **cómo funciona en 3 pasos numerados** (publicar,
comparar, reservar); testimonios; puntajes de tres sitios de reseñas; un bloque de
**garantías** (pagos seguros, plan de protección, seguimiento); logos de clientes; «hacerte
transportista»; guías de costos; y **FAQ en acordeón** con preguntas de confianza («¿es
legítimo?», «¿cómo se verifica a los transportistas?», «¿qué pasa si se daña?»).

**Freightos.** Hero con degradé de marca, título de infraestructura y bajada larga, con el
banner de cookies encima del primer pantallazo. Debajo: los tres productos por público,
«historias reales» (testimonios con cargo y empresa), **FAQ** y un cierre con CTA. Prueba
social: logos y premios.

## 2. Patrones
| Patrón | Quién lo usa | ¿Aplica a TruckPool hoy? |
|---|---|---|
| **Acción principal como formulario corto en el hero** (buscar, seguir o cotizar) en lugar de un botón suelto | Andreani, uShip, Flexport (email) | **Sí.** Buscador origen / destino / fecha → `/viajes`. El server ya filtra por `origin`, `destination` y `dateFrom` (`listTripsQuerySchema`). Falta que `/viajes` lea esos parámetros de la URL: es un cambio de client, el contrato no se toca. |
| **Pestañas por rol o tarea** en la tarjeta del hero | Andreani | **Sí.** «Busco lugar para mi carga» / «Tengo un camión con lugar» resuelve los dos roles con un solo naranja. |
| **El otro lado del mercado como CTA secundario** (contorno) | uShip, Uber Freight (menú) | **Sí** (ya está en A). |
| **Franja de garantías** con ícono + título + una línea | Mercado Libre, uShip | **Sí, con las cuatro que son ciertas hoy** (ver §3). |
| **Ilustración plana propia** del rubro | Andreani | **Sí.** Se dibuja con el lenguaje del plano de A, sin personas. |
| **Foto real con tarjetas del producto encima** | uShip, Flexport (captura) | **Las tarjetas sí, la foto no.** No hay fotos propias y no usamos stock con derechos de terceros. La tarjeta de un viaje real sobre la ilustración cumple el papel de «el producto existe». |
| **Producto real como prueba** (captura o datos vivos) | Flexport, uShip | **Sí.** Viajes reales de la semana con sus m³ libres. Es la prueba social que sí tenemos. |
| **Cómo funciona en 3 pasos numerados** | uShip, Andreani (accesos) | **Sí.** Es una secuencia real (buscar → reservar y señar → retiro y seguimiento). |
| **Política de plata explícita** (qué se devuelve y cuándo) | uShip (protección), ML (compra protegida) | **Sí, y es nuestro punto fuerte**: la regla de devolución es concreta (>48 h toda, 24–48 h la mitad, <24 h nada; si el viaje no sale, toda). Va como tabla, no como letra chica. |
| **FAQ en acordeón** con preguntas de confianza | Andreani, uShip, Freightos | **Sí**, con respuestas que salen de reglas del server (verificación, cancelación, retiro, seguimiento). |
| **Números de escala** (envíos, km, empresas) | Andreani, Uber Freight | **No todavía.** Recién lanzamos: un «12 viajes publicados» resta en vez de sumar. Volver cuando haya volumen. |
| **Testimonios y puntajes de terceros** | uShip, Freightos | **No todavía.** Ya sacamos los testimonios ficticios (RD2). Cuando haya reseñas de viajes completados, se puede mostrar el promedio real de los fleteros. |
| **Logos de clientes** | OCA, Flexport, uShip, Freightos | **No todavía.** No hay clientes con permiso para mostrarlos. |
| **Sellos regulatorios en el footer** | Andreani | **Más adelante.** Aplica cuando haya razón social y alta formal (no es diseño). |
| **Carrusel de promos** | Mercado Libre, OCA | **No.** Esconde la acción principal y no tenemos promos. |
| **Hero oscuro corporativo con «hablar con un experto»** | Uber Freight, Flexport | **No.** Es venta B2B larga; nuestro usuario reserva solo, en minutos. |
| **Banners encima del hero** (prensa, cookies) | Uber Freight, Flexport, Freightos | **No.** Empujan el hero hacia abajo. |

## 3. Garantías: lo que podemos prometer y cómo decirlo
Cada garantía tiene que ser una regla que el sistema ya cumple. Si no, no va.

| Garantía | Regla que la sostiene | Copy propuesto |
|---|---|---|
| Pagás con Mercado Pago | Seña y saldo se cobran con Checkout de MP en la cuenta del fletero (`lib/mercadopago.ts`). | «La seña y el saldo se pagan por Mercado Pago.» |
| Fleteros verificados | Solo publica un fletero con `verificationStatus = VERIFIED` (`trips.service.ts:550`); el admin aprueba el DNI/CUIT y sin CUIT no se aprueba (Admin#1). | «Antes de publicar, cada fletero pasa por la revisión de su DNI o CUIT.» |
| Si el viaje no sale, te devolvemos la seña | Si el fletero cancela, cada seña pagada se devuelve completa; si no sale dentro de las 24 h siguientes a la salida, el viaje se cancela solo (D6). | «Si el viaje se cancela, te devolvemos toda la seña.» |
| Seguí tu carga en el mapa | El fletero comparte la ubicación desde el celular (`TrackTrip.tsx`) y las empresas con carga la ven en el mapa del viaje; con el código, «Rastrear un envío» muestra el estado. | «Mientras el fletero comparte su ubicación, ves dónde va el camión.» Hay que decir «mientras comparte»: depende del fletero. |

Otras que **no** se pueden decir hoy: «carga asegurada» (no hay seguro), «llega en X días»
(no hay compromiso de tiempo) y «miles de fleteros» (no es verdad todavía).

## 4. Tono del copy
- **Sí**: de vos, sentence case y verbos concretos, como Andreani y Mercado Libre («Seguí tu
  envío», «Buscá un viaje»). La promesa en una línea, como uShip: qué hacés y qué ganás.
- **No**: el de usted corporativo de Uber Freight, los títulos de «infraestructura» o «IA» de
  Flexport y Freightos, ni las MAYÚSCULAS de los banners promocionales.
- Las garantías se escriben como reglas, no como adjetivos: «te devolvemos toda la seña» en
  lugar de «pagos 100 % seguros».

## 5. Lo que cambia en la landing de A (debajo del hero)
La landing de A tenía cuatro problemas:
- secciones sueltas sobre el gris, con títulos de 21 px pegados a un H1 de 56 px;
- la línea de tiempo con cinco círculos vacíos iguales, que no se leía como plata;
- el mismo viaje dos veces (en el hero y en la lista);
- un bloque de fleteros con una línea más ancha que el contenido y un link suelto como única
  acción.

Las dos maquetas nuevas comparten un mismo «debajo del hero», ordenado como en uShip y
Andreani:
1. Garantías (dentro o al pie del hero).
2. Viajes que salen esta semana: la prueba de que hay viajes.
3. Cómo funciona, en 3 pasos.
4. Qué pasa con tu plata: la línea de tiempo con montos de ejemplo y la tabla de devoluciones.
5. Banda para fleteros.
6. Preguntas frecuentes.
7. Footer.

Ver [`heroes/`](./heroes/).
