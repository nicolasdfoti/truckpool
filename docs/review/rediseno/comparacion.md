# Rediseño A — antes y después

`main` (`336de8a`) contra `feat/rediseno-moderno`, pantalla por pantalla. Las dos versiones corrieron
a la vez desde un `git worktree` (main en :5174, la rama en :5175) contra la misma API
(`JOBS_ENABLED=false`), con `npm run db:seed:e2e` antes de cada corrida y el mismo script:
[`capturas.mjs`](./capturas.mjs).

- Desktop 1440 × 900 y mobile 390 × 844 (dpr 2), `es-AR`, hora de Buenos Aires, movimiento reducido.
- Cada tabla muestra la primera pantalla, lo que se ve al abrir. Para no cargar el repo, la página
  completa no se guarda: `COMPLETA=1` en `capturas.mjs` la genera.
- **Datos simulados:** en dev el listado público está vacío, porque los fleteros del seed no tienen
  Mercado Pago conectado. Dos capturas (`inicio-con-viajes` y `viajes-con-viajes`) responden
  `GET /trips` con 4 viajes de ejemplo de «Transportes de ejemplo». La respuesta es la misma para
  las dos versiones y el resto usa la API real.

Para regenerar: ver el encabezado de `capturas.mjs`.

## Pantallas

- [Landing, visitante](#inicio)
- [Landing con viajes publicados (datos de ejemplo, `/trips` simulado)](#inicio-con-viajes)
- [Listado con viajes (datos de ejemplo, `/trips` simulado)](#viajes-con-viajes)
- [Listado sin resultados](#viajes)
- [Listado con `?origen=Córdoba`](#viajes-buscador)
- [Detalle del viaje, visitante](#viaje-anonimo)
- [Detalle, empresa con cargas propias (`e2e-trip-lifecycle`)](#viaje-empresa)
- [Detalle, empresa participante (`e2e-trip-roles`)](#viaje-empresa-roles)
- [Detalle, fletero dueño del viaje](#viaje-fletero)
- [Detalle, viaje en tránsito (empresa)](#viaje-en-transito)
- [Publicar viaje (fletero)](#publicar)
- [Ingresar / crear cuenta](#ingresar)
- [Rastrear un envío](#rastrear)
- [Fleteros](#fleteros)
- [Perfil, empresa](#perfil-empresa)
- [Perfil, fletero](#perfil-fletero)
- [Solicitudes de viaje (empresa)](#solicitudes)
- [Panel admin](#admin)
- [Verificaciones de identidad (admin)](#admin-verificaciones)
- [Nosotros](#nosotros)
- [404](#no-encontrada)

<a id="inicio"></a>

## Landing, visitante

El hero deja la foto con el título en mayúsculas y los dos CTA en competencia. Ahora el buscador es la acción principal: origen, destino y fecha llevan a `/viajes` con los filtros en la URL. El fletero tiene su pestaña. Abajo van las secciones nuevas: cómo funciona, qué pasa con tu plata, la banda para fleteros y las preguntas frecuentes. En el header, «Crear cuenta» pasa a navy: el naranja queda para la búsqueda.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/inicio-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/inicio-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/inicio-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/inicio-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="inicio-con-viajes"></a>

## Landing con viajes publicados (datos de ejemplo, `/trips` simulado)

La sección «Próximas salidas» sólo aparece si hay viajes con lugar. En dev no hay ninguno público (los fleteros del seed no tienen MP), así que la captura simula `/trips` con 4 viajes, iguales en las dos versiones. En `main` no cambia nada porque esa sección no existe.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/inicio-con-viajes-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/inicio-con-viajes-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/inicio-con-viajes-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/inicio-con-viajes-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="viajes-con-viajes"></a>

## Listado con viajes (datos de ejemplo, `/trips` simulado)

«Ventana de viajes» pasa a «Viajes con lugar». Los filtros son compactos y los extras, chips. Las tarjetas dicen lo que importa a la empresa: m³ libres, precio por m³ y la caja del camión en chico. Toda la tarjeta lleva al viaje, así que se va el botón navy repetido.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/viajes-con-viajes-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/viajes-con-viajes-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/viajes-con-viajes-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/viajes-con-viajes-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="viajes"></a>

## Listado sin resultados

El estado vacío real de dev: sin viajes públicos.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/viajes-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/viajes-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/viajes-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/viajes-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="viajes-buscador"></a>

## Listado con `?origen=Córdoba`

La rama lee `origen`, `destino` y `desde` de la URL y los vuelca en los filtros. `main` ignora la URL y muestra los filtros vacíos.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/viajes-buscador-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/viajes-buscador-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/viajes-buscador-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/viajes-buscador-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="viaje-anonimo"></a>

## Detalle del viaje, visitante

La cabecera es blanca con los datos del viaje en una lista y la etapa del viaje (Abierto → Lleno → En camino → Completado). El diagrama de colores pasa a ser el camión de perfil: lo ocupado rayado y lo libre con su cota. A la derecha va el formulario para sumar carga.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/viaje-anonimo-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/viaje-anonimo-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/viaje-anonimo-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/viaje-anonimo-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="viaje-empresa"></a>

## Detalle, empresa con cargas propias (`e2e-trip-lifecycle`)

Dos columnas en desktop. «Tus cargas» va a la derecha con la línea de tiempo del dinero de cada una (reserva → seña → confirmación → salida → saldo) y una sola acción en naranja: «Pagar seña». En `main`, la barra de colores usaba naranja para la primera carga y las acciones estaban en la lista de paradas.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/viaje-empresa-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/viaje-empresa-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/viaje-empresa-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/viaje-empresa-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="viaje-empresa-roles"></a>

## Detalle, empresa participante (`e2e-trip-roles`)

Las cargas ajenas se ven rayadas y sin datos; las propias, lisas y con su etiqueta.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/viaje-empresa-roles-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/viaje-empresa-roles-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/viaje-empresa-roles-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/viaje-empresa-roles-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="viaje-fletero"></a>

## Detalle, fletero dueño del viaje

El panel del dueño y el manifiesto con todas las cargas van a la derecha. «Cancelar viaje» y «Marcar en tránsito» van en sentence case, y la acción principal es la única naranja.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/viaje-fletero-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/viaje-fletero-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/viaje-fletero-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/viaje-fletero-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="viaje-en-transito"></a>

## Detalle, viaje en tránsito (empresa)

La barra de etapa marca «En camino». En la línea de tiempo, el saldo es el paso actual y «Pagar saldo» es el único naranja. Esta captura mostró un error que ya está corregido en `764aca9`: la carga del seed está confirmada sin seña, y la seña quedaba marcada como «ahora» detrás de pasos hechos.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/viaje-en-transito-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/viaje-en-transito-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/viaje-en-transito-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/viaje-en-transito-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="publicar"></a>

## Publicar viaje (fletero)

Usa la escala de títulos nueva, campos de 44 px con borde 3:1 y etiqueta arriba, y los extras como chips. Los avisos de verificación y Mercado Pago van en sentence case.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/publicar-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/publicar-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/publicar-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/publicar-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="ingresar"></a>

## Ingresar / crear cuenta

La pantalla tiene un h1. Las pestañas son subrayadas (`aria-pressed`) y las etiquetas van en mayúscula inicial. Los botones dicen «Entrar» y «Crear cuenta».

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/ingresar-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/ingresar-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/ingresar-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/ingresar-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="rastrear"></a>

## Rastrear un envío

La pantalla tiene título y una bajada que explica qué código pegar. Antes era sólo el campo.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/rastrear-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/rastrear-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/rastrear-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/rastrear-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="fleteros"></a>

## Fleteros

Se llama «Fleteros», como en la nav. Las tarjetas ya no aprietan el nombre: avatar y nombre arriba, y viajes y calificación en una línea. La disponibilidad va como chip y «Ver perfil» en contorno; sólo la empresa ve «Solicitar viaje», en naranja.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/fleteros-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/fleteros-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/fleteros-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/fleteros-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="perfil-empresa"></a>

## Perfil, empresa

Título y bajada con la escala de A, campos con la etiqueta arriba y títulos de sección en sentence case.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/perfil-empresa-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/perfil-empresa-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/perfil-empresa-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/perfil-empresa-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="perfil-fletero"></a>

## Perfil, fletero

«Guardar perfil» pasa a navy para que el naranja quede en «Conectar Mercado Pago», que es lo que le falta al fletero para publicar.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/perfil-fletero-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/perfil-fletero-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/perfil-fletero-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/perfil-fletero-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="solicitudes"></a>

## Solicitudes de viaje (empresa)

Sólo cambia el barrido: radios, bordes y escala de títulos.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/solicitudes-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/solicitudes-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/solicitudes-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/solicitudes-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="admin"></a>

## Panel admin

El barrido, y en el header el link «Admin» con las verificaciones pendientes (`3924dc8`, adelantado de
L9): el admin entra directo acá después de ingresar.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/admin-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/admin-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/admin-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/admin-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="admin-verificaciones"></a>

## Verificaciones de identidad (admin)

El barrido y el link «Admin» del header, con el número de pendientes. «Aprobar» sigue deshabilitado
sin CUIT.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/admin-verificaciones-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/admin-verificaciones-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/admin-verificaciones-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/admin-verificaciones-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="nosotros"></a>

## Nosotros

Se van los rótulos en mayúsculas y el gráfico de fondo del hero, y los textos pasan a sentence case. Los CTA siguen la regla de A: naranja para la empresa y contorno para el fletero (antes, el naranja estaba en el del fletero).

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/nosotros-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/nosotros-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/nosotros-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/nosotros-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

<a id="no-encontrada"></a>

## 404

El ícono va en navy claro y «Ver viajes disponibles» en navy; los textos, en sentence case.

| Antes (`main`) | Después (rama) |
|---|---|
| ![antes, desktop](comparacion/antes/no-encontrada-desktop-pantalla.jpg) | ![después, desktop](comparacion/despues/no-encontrada-desktop-pantalla.jpg) |

| Antes, mobile | Después, mobile |
|---|---|
| <img src="comparacion/antes/no-encontrada-mobile-pantalla.jpg" alt="antes, mobile" width="300"> | <img src="comparacion/despues/no-encontrada-mobile-pantalla.jpg" alt="después, mobile" width="300"> |

