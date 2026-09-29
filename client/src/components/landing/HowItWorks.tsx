import { ArrowRight, FileText, Handshake, Truck, User } from "../icons";

const STEPS = [
  {
    title: "REGÍSTRATE",
    description: "Crea tu cuenta gratis y verifica tu perfil de empresa o transporte.",
    icon: User,
    circle: "bg-step-2",
    iconColor: "text-brand",
  },
  {
    title: "PUBLICA O BUSCA",
    description: "Sube tu carga disponible o encuentra viajes que coincidan con tu ruta.",
    icon: FileText,
    circle: "bg-step-2",
    iconColor: "text-brand",
  },
  {
    title: "CONECTA Y ACUERDA",
    description: "Negocia tarifas, acepta ofertas y confirma los detalles del viaje.",
    icon: Handshake,
    circle: "bg-step-3",
    iconColor: "text-success",
  },
  {
    title: "VIAJA Y COMPLETA",
    description: "Realiza el transporte con seguimiento y califica la experiencia.",
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
