import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import { Button } from "../Button";
import {
  Building2,
  Calendar,
  CheckCircle,
  Clock,
  DollarSign,
  LayoutDashboard,
  Search,
  ShieldCheck,
  TrendingUp,
  Truck,
  type IconProps,
} from "../icons";

type Feature = {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
};

function FeatureListItem({
  icon: Icon,
  title,
  description,
  colorClass,
}: Feature & { colorClass: string }) {
  return (
    <div className="mb-4 flex items-start">
      <div className={`mr-3 mt-1 ${colorClass}`}>
        <Icon size={20} />
      </div>
      <div>
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        <p className="text-sm text-ink-soft">{description}</p>
      </div>
    </div>
  );
}

const COMPANY_FEATURES: Feature[] = [
  {
    icon: ShieldCheck,
    title: "TRANSPORTISTAS VERIFICADOS",
    description: "Accede a una red confiable y validada por nuestro equipo.",
  },
  {
    icon: Clock,
    title: "PUBLICA EN MINUTOS",
    description: "Proceso de publicación simple, rápido y sin fricciones.",
  },
  {
    icon: DollarSign,
    title: "OFERTAS COMPETITIVAS",
    description: "Ahorra en costos al conectar con transportes de retorno.",
  },
  {
    icon: LayoutDashboard,
    title: "GESTIÓN CENTRALIZADA",
    description: "Controla todos tus envíos desde un único dashboard intuitivo.",
  },
];

const CARRIER_FEATURES: Feature[] = [
  {
    icon: Calendar,
    title: "LLENA TU CAPACIDAD",
    description: "Encuentra cargas de retorno y maximiza el uso de tus vehículos.",
  },
  {
    icon: TrendingUp,
    title: "AUMENTA INGRESOS",
    description: "Optimiza tus rutas actuales para generar mayores ganancias.",
  },
  {
    icon: Search,
    title: "BÚSQUEDA AVANZADA",
    description: "Filtra oportunidades por tipo de camión, ruta y fecha.",
  },
  {
    icon: CheckCircle,
    title: "REDUCE VIAJES VACÍOS",
    description: "Menos costos operativos, más rentabilidad por cada viaje.",
  },
];

function AudienceCard({
  features,
  icon: Icon,
  iconColor,
  barColor,
  role,
  subtitle,
  ctaTo,
  ctaLabel,
  ctaVariant,
}: {
  features: Feature[];
  icon: ComponentType<IconProps>;
  iconColor: string;
  barColor: string;
  role: string;
  subtitle: string;
  ctaTo: string;
  ctaLabel: string;
  ctaVariant: "primary" | "dark";
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[10px] border border-line bg-white shadow-xl">
      <div className={`h-2 w-full ${barColor}`} />
      <div className="flex-grow p-8 sm:p-10">
        <div className="mb-8 flex items-center justify-center lg:justify-start">
          <Icon className={`mr-4 h-10 w-10 ${iconColor}`} />
          <h3 className="font-display text-2xl font-semibold text-ink">
            {role} <br />
            <span className="text-lg font-medium text-ink-soft">{subtitle}</span>
          </h3>
        </div>

        <div className="space-y-6">
          {features.map((feature) => (
            <FeatureListItem key={feature.title} {...feature} colorClass={iconColor} />
          ))}
        </div>
      </div>
      <div className="mt-auto p-8 pt-0">
        <Button asChild variant={ctaVariant} size="md" className="w-full">
          <Link to={ctaTo}>{ctaLabel}</Link>
        </Button>
      </div>
    </div>
  );
}

export function AudienceCards() {
  return (
    <section className="relative z-20 -mt-32 mb-20 mx-auto max-w-7xl px-4 sm:px-6 lg:-mt-48 lg:px-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <AudienceCard
          role="PARA EMPRESAS"
          subtitle="(DUEÑOS DE CARGA)"
          features={COMPANY_FEATURES}
          icon={Building2}
          iconColor="text-brand"
          barColor="bg-brand"
          ctaTo="/ingresar?tab=register&role=company"
          ctaLabel="Comenzar como Empresa"
          ctaVariant="dark"
        />
        <AudienceCard
          role="PARA TRANSPORTISTAS"
          subtitle="(FLOTAS Y AUTÓNOMOS)"
          features={CARRIER_FEATURES}
          icon={Truck}
          iconColor="text-accent-strong"
          barColor="bg-accent"
          ctaTo="/ingresar?tab=register&role=carrier"
          ctaLabel="Comenzar como Transportista"
          ctaVariant="primary"
        />
      </div>
    </section>
  );
}
