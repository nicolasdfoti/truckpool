# Heroes nuevos para la landing (dirección A)
Salen de [`referencias.md`](../referencias.md). Los dos usan los tokens de
[`a-plano/estilos.css`](../a-plano/estilos.css) y comparten el mismo «debajo del hero», también
nuevo (ver abajo). No hay fotos: las ilustraciones son SVG propios con el lenguaje del plano.

| | Maqueta | Desktop | Mobile | Mobile, 1.ª pantalla |
|---|---|---|---|---|
| Hero 1 · buscador con pestañas | [html](./hero-1.html) | [captura](./capturas/hero-1-desktop.png) | [captura](./capturas/hero-1-mobile.png) | [captura](./capturas/hero-1-mobile-pantalla.png) |
| Hero 2 · buscador ancho y mapa de salidas | [html](./hero-2.html) | [captura](./capturas/hero-2-desktop.png) | [captura](./capturas/hero-2-mobile.png) | [captura](./capturas/hero-2-mobile-pantalla.png) |

## Hero 1 · buscador con pestañas
Fondo blanco, en dos columnas.
- **Izquierda**: título, una línea de promesa y una tarjeta con dos pestañas (patrón de
  Andreani):
  - «Busco lugar para mi carga»: origen, destino, «desde el» y **Buscar viajes** (el naranja).
  - «Tengo un camión con lugar»: qué hace el fletero, **Publicar mi viaje** y qué necesita para
    publicar.

  Se ve una pestaña por vez, así que la pantalla tiene un solo naranja.
- **Derecha**: el semi del plano con el espacio libre acotado, sobre una cuadrícula con el
  recorrido, y encima la tarjeta de un viaje real (patrón de uShip: el producto encima de la
  imagen) con el fletero verificado.
- **Al pie del hero**, la franja de las cuatro garantías.

En mobile, la tarjeta del buscador entra completa en la primera pantalla. La ilustración y la
tarjeta del viaje bajan, y las garantías quedan en una columna.

**A favor**: es el más «de servicio» y resuelve los dos roles sin repetir la elección tres
veces (Landing#3). **En contra**: la ilustración repite el diagrama del detalle, y la primera
vez que se ve es en la landing.

## Hero 2 · buscador ancho y mapa de salidas
Banda navy oscuro arriba, centrada.
- Título y promesa.
- **Barra de búsqueda ancha** (origen | destino | fecha | Buscar viajes), con «¿Tenés un camión
  con lugar? Publicá tu viaje» como link.
- Las garantías en fila, sobre el navy.
- Un **mapa esquemático de salidas**, estilo plano de subte: las ciudades son estaciones y cada
  viaje publicado es una línea con su chip «16 m³ libres». Cae sobre el borde de la banda. No
  dibuja el contorno del país: es un esquema.

En mobile, el mapa esquemático se oculta (a 390 px no se lee) y la primera pantalla queda
con el buscador completo. Los viajes aparecen en «Próximas salidas con lugar».

**A favor**: transmite red y movimiento, y el buscador es lo primero que se ve, como en las
páginas de envíos. **En contra**: en desktop los viajes se ven dos veces (en el mapa y en las
tarjetas de abajo), y el mapa necesita datos reales con rutas para no quedar vacío con pocos
viajes.

## El debajo del hero, rehecho (común a los dos)
| Antes (A) | Ahora |
|---|---|
| Secciones sueltas sobre el gris, con títulos de 21 px | Títulos de 26–34 px con su bajada y un ritmo fijo de 96 px entre secciones |
| Línea de tiempo con cinco círculos vacíos | **«Qué pasa con tu plata»**: barra 20/80 con la seña y el saldo del ejemplo, y al lado la **tabla de devoluciones** (>48 h, 24–48 h, <24 h y viaje cancelado) |
| El mismo viaje en el hero y en la lista | **«Próximas salidas con lugar»**: tres tarjetas de otros viajes, con el fletero verificado |
| Sin pasos, o pasos mezclados con la plata | **«Cómo funciona»** en 3 pasos numerados (es una secuencia real) |
| Bloque de fleteros con una línea desalineada y un link | **Banda navy para fleteros** con su CTA en contorno y los 3 pasos del fletero |
| Sin preguntas | **Preguntas frecuentes** en acordeón: las 5 respuestas salen de reglas del server (verificación, cancelación automática D6, ventanas de retiro, pago en dos partes, seguimiento) |

## Para pasarlo al client (si se elige)
- `/viajes` tiene que leer `?origen=&destino=&desde=` de la URL para que el buscador sirva. El
  server ya acepta `origin`, `destination` y `dateFrom`. Es un cambio de client y el contrato
  no cambia.
- «Próximas salidas» y el mapa de salidas salen de `GET /trips` (los primeros N abiertos con
  fecha futura). El mapa esquemático necesita posiciones fijas por ciudad: con origen o
  destino fuera de la lista no se dibuja.
- Las garantías son copy fijo. Si cambia una regla del server (por ejemplo, la devolución),
  cambia el texto.
