import { Button } from "../components/Button";
import { BrandGraphic } from "../components/landing/BrandGraphic";
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
    title: "confianza verificada",
    description:
      "cada transportista pasa por verificación de identidad y DNI/CUIT antes de publicar. las empresas saben con quién tratan.",
  },
  {
    Icon: TrendingUp,
    title: "eficiencia real",
    description:
      "no vendemos promesas. conectamos carga real con capacidad real. los kilómetros vacíos se reducen viaje a viaje.",
  },
  {
    Icon: Handshake,
    title: "relación directa",
    description:
      "sin intermediarios que inflan costos. la empresa y el transportista acuerdan precio, seña y condiciones entre ellos.",
  },
  {
    Icon: Leaf,
    title: "impacto medible",
    description:
      "cada carga compartida es un camión menos circulando vacío. menos emisiones, menos congestión, mejor logística.",
  },
];

export default function About() {
  return (
    <div className="bg-canvas font-sans selection:bg-canvas-line">
      {/* Hero narrativo */}
      <section className="relative overflow-hidden bg-brand-deep pb-20 pt-20 lg:pb-28 lg:pt-24">
        <div className="absolute inset-0 opacity-90">
          <BrandGraphic />
          <div className="absolute inset-0 bg-gradient-to-r from-brand-deep via-brand-deep/80 to-brand/60 mix-blend-multiply" />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl lg:max-w-2xl">
            <p className="mb-4 text-sm font-medium text-accent tracking-wider uppercase">
              sobre truckpool
            </p>
            <h1 className="mb-6 font-display text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
              movemos carga, no aire.
            </h1>
            <p className="mb-10 max-w-xl text-lg text-white/70 leading-relaxed">
              truckpool nace de una obviedad: miles de camiones recorren rutas con espacio
              vacío mientras empresas buscan cómo mover su mercadería. conectamos ambas
              partes en un marketplace donde el transportista publica su capacidad libre y
              la empresa suma su carga. el resultado: menos kilómetros vacíos, menos
              emisiones, mejor precio para todos.
            </p>

            <div className="flex flex-col justify-center gap-4 sm:flex-row lg:justify-start">
              <Button asChild variant="dark" size="md" className="shadow-lg">
                <a href="/ingresar?tab=register&role=company">
                  SOY EMPRESA, QUIERO PUBLICAR CARGA
                </a>
              </Button>
              <Button asChild variant="primary" size="md" className="shadow-lg">
                <a href="/ingresar?tab=register&role=carrier">
                  SOY TRANSPORTISTA, TENGO CAPACIDAD
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Sección: el problema que resolvemos */}
      <section className="py-16 lg:py-24 bg-canvas">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <header className="mb-12 text-center max-w-3xl mx-auto">
            <p className="mb-3 text-sm font-medium text-accent-text tracking-wider uppercase">
              el problema que resolvemos
            </p>
            <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              la logística tiene un problema de espacio vacío.
            </h2>
          </header>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            <article className="rounded-[10px] border border-line bg-white p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
                <Truck size={24} strokeWidth={2} />
              </div>
              <h3 className="mb-2 font-display text-xl font-semibold text-ink">
                camiones vacíos en ruta
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">
                en argentina, más del 40 % de los camiones viaja con espacio libre después
                de entregar su carga principal. eso son kilómetros que se pagan dos veces:
                una por el viaje de ida, otra por el regreso vacío.
              </p>
            </article>

            <article className="rounded-[10px] border border-line bg-white p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent-strong">
                <Building2 size={24} strokeWidth={2} />
              </div>
              <h3 className="mb-2 font-display text-xl font-semibold text-ink">
                empresas sin visibilidad
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">
                las empresas que necesitan mover mercadería no saben qué capacidad hay
                disponible en su ruta. terminan contratando camiones dedicados a precios
                altos o esperando semanas a que alguien les conteste.
              </p>
            </article>

            <article className="rounded-[10px] border border-line bg-white p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg/10 text-success-deep">
                <Leaf size={24} strokeWidth={2} />
              </div>
              <h3 className="mb-2 font-display text-xl font-semibold text-ink">
                impacto ambiental evitable
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">
                cada kilómetro vacío es CO₂ innecesario, congestión en rutas y desgaste de
                infraestructura. compartir la capacidad que ya existe es la forma más
                inmediata de reducir la huella del transporte.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* Sección: valores / principios */}
      <section className="py-16 lg:py-24 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <header className="mb-12 text-center max-w-3xl mx-auto">
            <p className="mb-3 text-sm font-medium text-accent-text tracking-wider uppercase">
              cómo lo hacemos
            </p>
            <h2 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              cuatro principios que guían cada decisión.
            </h2>
          </header>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4 max-w-5xl mx-auto">
            {VALUES.map(({ Icon, title, description }) => (
              <article
                key={title}
                className="text-center p-6 rounded-[10px] border border-line bg-canvas/50 hover:border-brand/50 transition-colors"
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand mx-auto">
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
            sumate a mover carga, no aire.
          </h2>
          <p className="mb-8 max-w-xl mx-auto text-lg text-white/70">
            ya sea que tengas capacidad libre en tu camión o mercadería que mover,
            truckpool es el punto de encuentro. registrate y empezá hoy.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row lg:justify-center">
            <Button
              asChild
              variant="outline-light"
              size="md"
              className="shadow-lg w-full sm:w-auto"
            >
              <a href="/ingresar?tab=register&role=company">EMPRESAS: PUBLICAR CARGA</a>
            </Button>
            <Button
              asChild
              variant="dark"
              size="md"
              className="shadow-lg w-full sm:w-auto"
            >
              <a href="/ingresar?tab=register&role=carrier">
                TRANSPORTISTAS: ENCONTRAR CARGA
              </a>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
