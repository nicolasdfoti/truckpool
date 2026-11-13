# Rediseño visual — fase 1: tres direcciones
Rama `feat/rediseno-moderno` (desde `main` en `336de8a`). Es una exploración y **no se mergea sin
OK**. En esta fase no se tocó código del client.

> **Actualización (2026-11-13):** el hero de la landing se rehízo sobre la dirección A a
> partir de un relevamiento de referencias. Ver [`referencias.md`](./referencias.md) y
> [`heroes/`](./heroes/README.md).

Las tres direcciones parten de lo mismo (`03-diseno.md` §4, L10 y `05-revision-diseno.md`):
- **El camión es la firma** y lo único audaz de cada pantalla. Va en el hero de la landing con
  un viaje real, en las filas del listado y en el detalle.
- **Hay un solo naranja por pantalla**: la próxima acción del usuario. «Crear cuenta», «Enviar» y
  «Publicar mi viaje» pasan a navy sólido u `outline`, y «Retirar carga» a `outline` danger. El
  diagrama deja de usar naranja para la primera carga (hoy `PALETTE[0]` es `#F58220`): tu
  carga va en el color de estructura, liso; las ajenas, rayadas; y lo libre, vacío.
- **El dinero es una línea de tiempo**: `Reserva → Seña → Confirmación → Salida → Saldo`, con
  fecha y monto. La próxima acción va marcada. La misma pieza aparece en la landing (como
  ejemplo) y en el panel «Tu carga».
- **El detalle es una hoja de ruta**: en desktop, dos columnas con el panel «Tu carga» fijo a
  la derecha. En mobile, el panel arriba y una barra fija abajo con la próxima acción
  («Pagar seña» y el vencimiento).
- **Copy en sentence case y con voseo**, sin ALL CAPS y sin testimonios. Lo de otras empresas se
  ve sin datos ajenos («Otra carga, 5 m³, retiro en Córdoba»). La numeración del mapa y la de
  la lista coinciden (Paradas#2).
- **Mismos datos en las tres**: los del seed. Córdoba → Mendoza, semi de 30 m³ a $ 100/m³, tu
  carga de 4 m³ ($ 400: seña $ 80, saldo $ 320) y 3 cargas ajenas (10 m³).

Las maquetas son HTML estático y responsive. Se abren directo en el navegador y cargan las
fuentes de Google Fonts. El mapa es un esquema: en la app sigue siendo Leaflet.

| | Landing | Detalle (empresa) |
|---|---|---|
| A · Plano de carga | [html](./a-plano/landing.html) · [desktop](./a-plano/capturas/landing-desktop.png) · [mobile](./a-plano/capturas/landing-mobile.png) | [html](./a-plano/detalle.html) · [desktop](./a-plano/capturas/detalle-desktop.png) · [mobile](./a-plano/capturas/detalle-mobile.png) · [1.ª pantalla](./a-plano/capturas/detalle-mobile-pantalla.png) |
| B · Remito | [html](./b-remito/landing.html) · [desktop](./b-remito/capturas/landing-desktop.png) · [mobile](./b-remito/capturas/landing-mobile.png) | [html](./b-remito/detalle.html) · [desktop](./b-remito/capturas/detalle-desktop.png) · [mobile](./b-remito/capturas/detalle-mobile.png) · [1.ª pantalla](./b-remito/capturas/detalle-mobile-pantalla.png) |
| C · Señalética vial | [html](./c-ruta/landing.html) · [desktop](./c-ruta/capturas/landing-desktop.png) · [mobile](./c-ruta/capturas/landing-mobile.png) | [html](./c-ruta/detalle.html) · [desktop](./c-ruta/capturas/detalle-desktop.png) · [mobile](./c-ruta/capturas/detalle-mobile.png) · [1.ª pantalla](./c-ruta/capturas/detalle-mobile-pantalla.png) |

Capturas a 1440×900 y a 390×844 (`isMobile`), de página completa. En la página completa, la
barra fija de mobile aparece al final; la «1.ª pantalla» la muestra en su lugar real.

---

## A · Plano de carga
**Idea.** Es la evolución de lo que ya hay. Mantiene las fuentes y el navy, y saca las tarjetas
apiladas: las secciones se separan con aire y líneas finas. El camión se dibuja de costado,
como un plano, con cotas: «30 m³» arriba y una flecha de punta a punta sobre el espacio libre
con «16 m³ libres».

**Paleta**
| Token | Hex | Uso |
|---|---|---|
| `paper` | `#FFFFFF` | hojas, header, panel |
| `canvas` | `#EEF3F7` | fondo (más frío y claro que el `#EAF1F7` de hoy) |
| `navy` | `#0B3D5C` | estructura, tu carga, botones secundarios |
| `navy-tint` | `#D6E3EC` | rayado de cargas ajenas, chip «abierto» |
| `ink` / `ink-soft` | `#15222E` / `#4A5866` | texto / secundario (≥ 4.5:1 sobre `canvas`) |
| `field` | `#6B7A88` | borde de inputs (≥ 3:1, hoy es 1.35:1) |
| `orange` / `orange-ink` | `#F58220` / `#3A1606` | **solo** la próxima acción |

**Tipografía.** Space Grotesk 600 para títulos y Inter 400/500 para el cuerpo, con
`tnum` para la plata. Es lo que pide 03 §4 y ya se carga. Escala: 13 · 15 · 17 · 21 · 28 ·
44 · 56 px.

**Espaciado.** Base de 4 px: 4 / 8 / 12 / 16 / 24 / 40 / 64 / 96. Radios de 8 px en botones y
de 12 px en hojas.

**Componentes clave**
- Diagrama: SVG de perfil, con el tráiler, la cabina y las ruedas, y las cotas de total y de
  libre. Se adapta a cualquier capacidad (18, 30 o 90 m³) y a volúmenes con decimales.
- Línea de tiempo: vertical en el panel (punto lleno con ✓ = hecho, anillo naranja = ahora,
  hueco = después) y horizontal en la landing.
- Barra de estado del viaje en 4 tramos (Abierto, Lleno, En camino, Completado).
- Listado en filas en lugar de tarjetas, con una mini barra rayada.

**Costo.** Es el más bajo: no cambia fuentes y casi todo sale de los tokens de `index.css`.
**Riesgo:** de las tres, es la menos memorable.

## B · Remito
**Idea.** El papel de la carga. El detalle se arma como una carta de porte, con campos en caja
y la etiqueta arriba a la izquierda. El piso del camión se ve desde arriba, **con una celda por
m³**: se cuentan los lugares libres. La plata es un talonario de cupones con perforado, y el
paso hecho lleva un sello «hecho». El botón de pagar vive dentro del cupón de la seña.

**Paleta**
| Token | Hex | Uso |
|---|---|---|
| `desk` | `#F2F4F5` | fondo (gris frío, no crema) |
| `sheet` | `#FFFFFF` | hojas |
| `carbon` | `#2A4793` | azul de carbónico: estructura, etiquetas de campo, tu carga (reemplaza al navy) |
| `carbon-tint` | `#E4EAF6` | rayado ajeno, fila propia resaltada |
| `ink` / `ink-soft` | `#1B1F27` / `#535B68` | texto |
| `rule` | `#C3CAD3` | cajas de los campos |
| `sello` | `#1F7A48` | «hecho», acreditado |
| `orange` / `orange-ink` | `#F58220` / `#3A1606` | solo la próxima acción |

**Tipografía.** Public Sans (la familia de formularios del gobierno de EE. UU.) en todo: 800
para títulos con tracking negativo, 500 a 12 px en azul para las etiquetas de campo y 400 para
el cuerpo. El «³» de Public Sans es muy grande en los títulos y necesita una clase propia.

**Espaciado.** Base de 4 px, más denso: 4 / 8 / 12 / 16 / 20 / 32 / 48 / 72. Radios de 3 px en
hojas y de 6 px en botones.

**Componentes clave**
- Piso de 15 × 2 celdas que se llena de adelante hacia atrás, con la cabina al costado.
- Talonario: horizontal en la landing (5 cupones) y vertical en el panel.
- Campos en caja (`<dl>` en grilla) para los datos del viaje y de la carga.
- Listado como **planilla** (`<table>` real), con una barra de celdas por viaje. En mobile pasa
  a filas apiladas.

**Costo.** Medio: cambia la fuente y el azul. **Riesgos:** la celda por m³ no escala bien
(un camión de 90 m³ son 90 celdas, y 2,5 m³ necesita medias celdas), así que haría falta una
regla (por ejemplo, 1 celda = 2 m³ arriba de 40 m³). El borde punteado de las celdas libres da
2.1:1 y hay que subirlo a ≥ 3:1. Con tantas líneas de caja, el estilo puede volverse
burocrático.

## C · Señalética vial
**Idea.** Los carteles de ruta. El hero de la landing es un **cartel de destinos** con los
viajes reales de la semana: destino, origen, fecha, m³ libres y precio, como un cartel que
lista ciudades y km. El encabezado del detalle es un cartel azul con el filete blanco interior
de la señalización vial, y el camión va adentro como pictograma macizo. La plata son mojones
al costado de una ruta con la línea discontinua.

**Paleta**
| Token | Hex | Uso |
|---|---|---|
| `page` | `#EDF0F2` | fondo |
| `white` | `#FFFFFF` | cajas, mojones |
| `sign` | `#0A4A7C` | azul de cartel: paneles, estructura, tu carga (algo más vivo que el navy) |
| `sign-deep` | `#073A62` | interior del tráiler en el cartel, footer |
| `road` | `#39434C` | asfalto de la línea de tiempo y de la barra de estado |
| `ink` / `ink-soft` | `#1A2530` / `#4F5B66` | texto |
| `orange` / `orange-ink` | `#F58220` / `#3A1606` | solo la próxima acción |

**Tipografía.** Overpass, que deriva de la Highway Gothic de los carteles de ruta: 800 para
títulos y datos grandes, y 400/600/700 para el cuerpo, a 16 px. Escala: 15 · 16 · 19 · 22 ·
30 · 60 · 76 px.

**Espaciado.** Base de 8 px y generoso: 8 / 16 / 24 / 32 / 48 / 80 / 120. Botones de 48 px de
alto y radios de 10 px; los carteles, de 18 px.

**Componentes clave**
- Cartel (`.sign`): panel azul con el filete blanco. Se usa **solo** en el hero de la landing y
  en el encabezado del detalle; usado en todos lados pierde fuerza.
- Pictograma del camión en dos versiones: azul sobre blanco (landing) y blanco sobre azul
  (cartel del detalle), con la carga propia lisa, las ajenas rayadas y lo libre vacío.
- Mojones: en horizontal sobre la ruta (landing) y en vertical en el panel. El hecho va con
  borde verde y ✓; el actual, con borde azul grueso.
- Barra de estado del viaje como una franja de asfalto con el tramo actual en blanco.

**Costo.** Medio: cambia la fuente y el azul, y suma dos componentes visuales (cartel y
mojones). **Riesgos:** pesa más visualmente, así que hay que cuidar que el cartel no aparezca
en todas las pantallas. En mobile, el cartel con el pictograma ocupa casi una pantalla antes
del panel «Tu carga».

---

## Cómo se revisó cada plan contra los clichés
- A: el primer borrador usaba tarjetas blancas iguales con sombra para cada sección (el
  «SaaS-card kit»). Pasó a secciones separadas con aire, y quedan solo dos elevaciones: la hoja
  y el panel.
- B: el riesgo era el fondo crema + serif del «papel». El papel quedó en gris frío y la letra es
  una sans de formularios. Las líneas son las cajas de un formulario, no las columnas de un
  diario.
- C: el riesgo era el «navy oscuro + un acento». El fondo de página sigue siendo claro, y el azul
  vive solo dentro de los carteles, que tienen un borde con significado (el de la señal
  vial).
- En las tres: sin eyebrows en mayúsculas, sin `→` pegado a los links y sin monoespaciada para
  datos. Las únicas flechas son las del recorrido (Córdoba → Mendoza) y el «← volver».

## A decidir con la dirección elegida
1. **Qué CTA de la landing lleva el naranja.** En las tres es el de la empresa («Buscar un
   viaje para mi carga»), y «Publicar mi viaje» queda en `outline`. Es la regla de un naranja
   por pantalla aplicada a una landing con dos roles.
2. **El orden en mobile del detalle.** En A y C, primero el viaje y después «Tu carga». En B,
   «Tu carga» va antes que los datos del viaje. Las tres tienen la barra fija abajo.
3. **Si la fase 2 incluye el listado.** Las maquetas lo muestran dentro de la landing (filas,
   planilla o cartel), y aplicarlo al `/viajes` real es parte de L10.

## Recomendación
**C**, con una condición. Es la más propia del rubro: el cartel de destinos muestra viajes
reales en el primer pantallazo, que es lo que pide L10 para la landing. Sus targets de 48 px y
su letra de 16 px atacan los problemas de 03 §3. Y el pictograma se lee de lejos. La
condición es usar el cartel solo en esas dos piezas. Si preferís el menor riesgo y el menor
diff, **A** cumple todo lo de L10 sin cambiar fuentes.
