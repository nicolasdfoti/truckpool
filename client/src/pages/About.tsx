import { Button } from "../components/Button";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  TrendingUp,
  Handshake,
  Leaf,
  Building2,
  Truck,
} from "../components/icons";

const VALUES = [
  {
    Icon: ShieldCheck,
    title: "Confianza verificada",
    description:
      "Cada transportista pasa por verificación de identidad y DNI/CUIT antes de publicar. Las empresas saben con quién tratan.",
  },
  {
    Icon: TrendingUp,
    title: "Eficiencia real",
    description:
      "No vendemos promesas. Conectamos carga real con capacidad real. Los kilómetros vacíos se reducen viaje a viaje.",
  },
  {
    Icon: Handshake,
    title: "Relación directa",
    description:
      "Sin intermediarios que inflan costos. La empresa y el transportista acuerdan precio, seña y condiciones entre ellos.",
  },
  {
    Icon: Leaf,
    title: "Impacto medible",
    description:
      "Cada carga compartida es un camión menos circulando vacío. Menos emisiones, menos congestión, mejor logística.",
  },
];

export default function About() {
  return (
    <div className="bg-canvas font-sans selection:bg-canvas-line">
      {/* Hero narrativo */}
      <section className="relative overflow-hidden bg-brand-deep pb-20 pt-20 lg:pb-28 lg:pt-24">
        <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-3xl lg:max-w-2xl">
            <h1 className="mb-6 font-display text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
              Movemos carga, no aire.
            </h1>
            <p className="mb-10 max-w-xl text-lg text-white/70 leading-relaxed">
              TruckPool nace de una obviedad: miles de camiones recorren rutas con espacio
              vacío mientras empresas buscan cómo mover su mercadería. Conectamos ambas
              partes en un marketplace donde el transportista publica su capacidad libre y
              la empresa suma su carga. El resultado: menos kilómetros vacíos, menos
              emisiones, mejor precio para todos.
            </p>

            <div className="flex flex-col justify-center gap-4 sm:flex-row lg:justify-start">
              <Button asChild variant="primary" size="md">
                <Link to="/viajes">Buscar un viaje para mi carga</Link>
              </Button>
              <Button asChild variant="outline-light" size="md" className="border-white">
                <Link to="/viajes/nuevo">Publicar mi viaje</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Sección: el problema que resolvemos */}
      <section className="py-16 lg:py-24 bg-canvas">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <header className="mb-12 text-center max-w-3xl mx-auto">
            <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              La logística tiene un problema de espacio vacío.
            </h2>
          </header>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            <article className="rounded-xl border border-line bg-white p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand">
                <Truck size={24} strokeWidth={2} />
              </div>
              <h3 className="mb-2 font-display text-xl font-semibold text-ink">
                Camiones vacíos en ruta
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">
                En Argentina, más del 40 % de los camiones viaja con espacio libre después
                de entregar su carga principal. Eso son kilómetros que se pagan dos veces:
                una por el viaje de ida, otra por el regreso vacío.
              </p>
            </article>

            <article className="rounded-xl border border-line bg-white p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-tint text-brand">
                <Building2 size={24} strokeWidth={2} />
              </div>
              <h3 className="mb-2 font-display text-xl font-semibold text-ink">
                Empresas sin visibilidad
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">
                Las empresas que necesitan mover mercadería no saben qué capacidad hay
                disponible en su ruta. Terminan contratando camiones dedicados a precios
                altos o esperando semanas a que alguien les conteste.
              </p>
            </article>

            <article className="rounded-xl border border-line bg-white p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-success-deep">
                <Leaf size={24} strokeWidth={2} />
              </div>
              <h3 className="mb-2 font-display text-xl font-semibold text-ink">
                Impacto ambiental evitable
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">
                Cada kilómetro vacío es CO₂ innecesario, congestión en rutas y desgaste de
                infraestructura. Compartir la capacidad que ya existe es la forma más
                inmediata de reducir la huella del transporte.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* Sección: valores / principios */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <header className="mb-12 text-center max-w-3xl mx-auto">
            <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              Cuatro principios que guían cada decisión.
            </h2>
          </header>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4 max-w-5xl mx-auto">
            {VALUES.map(({ Icon, title, description }) => (
              <article
                key={title}
                className="text-center p-6 rounded-xl border border-line bg-canvas/50 hover:border-brand/50 transition-colors"
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-tint text-brand mx-auto">
                  <Icon size={28} strokeWidth={2} />
                </div>
                <h3 className="mb-2 font-display text-lg font-semibold text-ink">
                  {title}
                </h3>
                <p className="text-sm text-ink-soft leading-relaxed">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-16 lg:py-24 bg-brand-deep">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="mb-4 font-display text-3xl font-semibold text-white sm:text-4xl">
            Sumate a mover carga, no aire.
          </h2>
          <p className="mb-8 max-w-xl mx-auto text-lg text-white/70">
            Ya sea que tengas capacidad libre en tu camión o mercadería que mover,
            TruckPool es el punto de encuentro. Registrate y empezá hoy.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row lg:justify-center">
            <Button asChild variant="primary" size="md" className="w-full sm:w-auto">
              <Link to="/viajes">Buscar un viaje para mi carga</Link>
            </Button>
            <Button
              asChild
              variant="outline-light"
              size="md"
              className="w-full border-white sm:w-auto"
            >
              <Link to="/viajes/nuevo">Publicar mi viaje</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
