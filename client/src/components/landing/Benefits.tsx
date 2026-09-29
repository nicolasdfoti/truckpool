import { Clock, DollarSign, Leaf, MapPin } from "../icons";

const ADVANTAGES = [
  {
    title: "AHORRO DE COSTOS",
    description:
      "Conectás con transportes que ya están en tu zona, en lugar de dispatchar un camión vacío.",
    icon: DollarSign,
    iconColor: "text-brand",
  },
  {
    title: "VISIBILIDAD EN TIEMPO REAL",
    description:
      "Seguís cada viaje desde el dashboard, con el estado y la ubicación de tu carga.",
    icon: Clock,
    iconColor: "text-brand",
  },
  {
    title: "OPTIMIZACIÓN DE RUTAS",
    description:
      "Los fleteros filtran por ruta y fecha, y encuentran viajes que ya les encajan.",
    icon: MapPin,
    iconColor: "text-success",
  },
  {
    title: "IMPACTO AMBIENTAL REDUCIDO",
    description: "Menos kilómetros en vacío significa menos emisiones por unidad movida.",
    icon: Leaf,
    iconColor: "text-success",
  },
];

export function Benefits() {
  return (
    <section className="border-t border-line bg-soft py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="font-display text-3xl font-semibold text-ink">
            NUESTRAS VENTAJAS
          </h2>
          <div className="mx-auto mt-2 h-1 w-24 rounded bg-brand" />
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-10 text-center md:grid-cols-4">
          {ADVANTAGES.map(({ title, description, icon: Icon, iconColor }) => (
            <div key={title} className="flex flex-col items-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[10px] bg-white shadow-sm">
                <Icon size={32} strokeWidth={2.5} className={iconColor} aria-hidden />
              </div>
              <h5 className="font-display text-sm font-semibold text-ink">{title}</h5>
              <p className="mt-2 text-sm text-ink-soft">{description}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center text-sm font-medium text-ink-muted">
          MVP: Publicación y Búsqueda, Dashboard. Próximamente: Chat, Pagos, IA.
        </div>
      </div>
    </section>
  );
}
