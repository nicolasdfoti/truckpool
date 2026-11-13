import { ArrowRight, FileText, Handshake, Truck, User } from "../icons";

const STEPS = [
  {
    title: "REGISTRATE",
    description: "Creá tu cuenta gratis como empresa o como transportista.",
    icon: User,
    circle: "bg-step-2",
    iconColor: "text-brand",
  },
  {
    // QW5: el transportista publica el viaje; la empresa no publica carga
    title: "PUBLICÁ O BUSCÁ",
    description:
      "El transportista publica su viaje con el espacio libre; la empresa busca uno que le sirva.",
    icon: FileText,
    circle: "bg-step-2",
    iconColor: "text-brand",
  },
  {
    // QW5: el precio es fijo por m³: no hay ofertas ni negociación
    title: "RESERVÁ Y PAGÁ LA SEÑA",
    description:
      "Reservás los m³ que necesitás a precio fijo y pagás la seña con Mercado Pago. El saldo, cuando sale el viaje.",
    icon: Handshake,
    circle: "bg-step-3",
    iconColor: "text-success",
  },
  {
    title: "SEGUÍ EL VIAJE",
    description: "Seguí el viaje en el mapa y, al llegar, calificá al transportista.",
    icon: Truck,
    circle: "bg-step-1",
    iconColor: "text-accent-strong",
  },
];

function Step({ step }: { step: (typeof STEPS)[number] }) {
  const Icon = step.icon;
  return (
    <div className="relative flex max-w-xs flex-col items-center text-center">
      <div
        className={`mb-6 flex h-20 w-20 items-center justify-center rounded-full border-4 border-line ${step.circle}`}
      >
        <Icon className={`h-10 w-10 ${step.iconColor}`} />
      </div>
      <h4 className="mb-2 font-display text-lg font-semibold text-ink">{step.title}</h4>
      <p className="text-sm text-ink-soft">{step.description}</p>
    </div>
  );
}

function StepWithArrow({ step, index }: { step: (typeof STEPS)[number]; index: number }) {
  return (
    <>
      <Step step={step} />
      {index < STEPS.length - 1 && (
        <ArrowRight className="h-8 w-8 flex-shrink-0 text-ink-muted md:block" />
      )}
    </>
  );
}

export function HowItWorks() {
  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <h2 className="font-display text-3xl font-semibold text-ink">CÓMO FUNCIONA</h2>
          <div className="mx-auto mt-2 h-1 w-24 rounded bg-brand" />
        </div>

        <div className="flex flex-col items-center justify-between space-y-12 md:flex-row md:space-x-4 md:space-y-0">
          {STEPS.map((step, i) => (
            <StepWithArrow step={step} index={i} key={step.title} />
          ))}
        </div>
      </div>
    </section>
  );
}
