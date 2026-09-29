/**
 * Datos de la seccion de social proof del Home.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTENIDO DE DEMOSTRACION. Todos los nombres, empresas, sectores, rutas y
 * cifras de este archivo son FICTICIOS y fueron inventados para el prototipo.
 * No corresponden a personas ni a empresas reales, y no deben leerse como
 * afirmaciones sobre operaciones existentes.
 *
 * Para pasar a datos reales no hay que tocar `TestimonialCarousel.tsx`: se
 * reemplaza este archivo por la consulta al backend y se mantiene la forma.
 * La forma de `Testimonial` es deliberadamente plana, para que encaje con lo
 * que devuelve la API de viajes.
 *
 * La seccion muestra un aviso visible de "datos de demostracion" mientras
 * `TESTIMONIALS_ARE_DEMO` sea true; al pasar a contenido real hay que ponerlo
 * en false para que ese aviso desaparezca.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type TestimonialAudience = "EMPRESA" | "TRANSPORTISTA";

export type Testimonial = {
  id: string;
  /** Nombre de la persona, tal como figuraria en una cita atribuida. */
  author: string;
  /** Cargo, para dar contexto a la opinion. */
  role: string;
  /** Empresa ficticia. */
  company: string;
  /** Sector de la empresa ficticia. */
  sector: string;
  audience: TestimonialAudience;
  /** 1 a 5. Se renderiza con estrellas, no con un numero. */
  rating: number;
  quote: string;
  /**
   * Dato operativo concreto (ruta o tipo de carga). Es lo que hace que la cita
   * se lea como contenido de logistica y no como una frase motivacional.
   */
  detail: string;
};

export const TESTIMONIALS: Testimonial[] = [
  {
    id: "t-distribuidora-litoral",
    author: "Mariana Sosa",
    role: "Jefa de Logística",
    company: "Distribuidora del Litoral",
    sector: "Alimentos y bebidas",
    audience: "EMPRESA",
    rating: 5,
    quote:
      "Antes llamábamos a cinco transportistas y las respuestas llegaban a destiempo. Ahora dejo la carga publicada y las ofertas entran solas, con el precio ya acordado.",
    detail: "Rosario → Buenos Aires, 18 t de mercadería palletsada",
  },
  {
    id: "t-camiones-sierra",
    author: "Hugo Báez",
    role: "Dueño",
    company: "Transportes Sierra",
    sector: "Camiones y transporte de carga",
    audience: "TRANSPORTISTA",
    rating: 5,
    quote:
      "Los viajes de vuelta son los que cambian el número. Publico la capacidad que me queda libre y completo la semana con rutas que igual tenía que hacer.",
    detail: "3 camiones, rutas Mendoza → San Juan",
  },
  {
    id: "t-textil-norte",
    author: "Diego Ferrari",
    role: "Coordinador de Envíos",
    company: "Textil del Norte",
    sector: "Confección y retail",
    audience: "EMPRESA",
    rating: 4,
    quote:
      "El filtro por tipo de camión nos ahorró casi todo el ida y vuelta de la mensajería. Cargo y tipo de carga coinciden, así que no perdemos tiempo negociando.",
    detail: "Córdoba → Santa Fe, carga palletsizada y carga refrigerada",
  },
  {
    id: "t-fletes-patagonia",
    author: "Carla Ruiz",
    role: "Flotista",
    company: "Fletes Patagonia",
    sector: "Autónomo con flota de 2",
    audience: "TRANSPORTISTA",
    rating: 5,
    quote:
      "Estoy a cuatro horas de cualquier centro de distribución y aun así me llegan ofertas de la zona. El seguimiento me evita tener que llamar por teléfono para preguntar dónde viene la carga.",
    detail: "Trelew → Comodoro Rivadavia, combustible y carga general",
  },
  {
    id: "t-agrodelta",
    author: "Nicolás Peralta",
    role: "Gerente de Suministro",
    company: "Agro Delta",
    sector: "Insumos agrícolas",
    audience: "EMPRESA",
    rating: 5,
    quote:
      "Publicamos cada lote y la red se ocupa. Dejamos de tener flota propia en espera y pagamos solo el transporte que usamos.",
    detail: "Bahía Blanca → Tandil, insumos en comodín",
  },
  {
    id: "t-transportes-uruguay",
    author: "Pablo Iriarte",
    role: "Socio fundador",
    company: "Transportes El Uruguay",
    sector: "Transporte de carga general",
    audience: "TRANSPORTISTA",
    rating: 4,
    quote:
      "El perfil verificado es lo que hizo la diferencia: la empresa sabe quién maneja y con qué unidad antes de aceptar. Cerramos más rápido y con menos discusiones.",
    detail: "4 vehículos, transporte de carga general",
  },
];

/**
 * Mientras sea true, la seccion rotula el contenido como demostracion. Poner
 * en false cuando los testimonios vengan de la base de datos.
 */
export const TESTIMONIALS_ARE_DEMO = true;
