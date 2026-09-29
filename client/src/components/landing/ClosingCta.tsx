import { Link } from "react-router-dom";
import { Button } from "../Button";
import { CheckCircle, ShieldCheck } from "../icons";

const TRUST_POINTS = [
  "Registro gratuito",
  "Transportistas verificados",
  "Seguimiento de cada viaje",
];

/**
 * Cierre del Home. El Hero abre con dos CTAs y la pagina terminaba en
 * "NUESTRAS VENTAJAS" sin ninguna accion posible: quien scrollea hasta el
 * final no tenia a donde ir. Este bloque cierra ese recorrido repitiendo los
 * mismos dos destinos del Hero, sobre el mismo fondo de marca para que el
 * inicio y el final se lean como un par.
 *
 * El lado izquierdo es el CTA y el derecho el argumento: en mobile se apilan.
 */
export function ClosingCta() {
  return (
    <section
      aria-labelledby="cta-titulo"
      className="relative overflow-hidden bg-brand-deep py-16 lg:py-20"
    >
      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2
              id="cta-titulo"
              className="mb-4 font-display text-3xl font-semibold leading-tight text-white sm:text-4xl"
            >
              PUBLICÁ TU CARGA O LLENÁ TU CAMIÓN HOY
            </h2>
            <p className="mb-8 max-w-lg text-lg text-white/70">
              Uníte a la red logística de TruckPool y empezá a mover carga en la próxima
              salida.
            </p>

            <div className="flex flex-col gap-4 sm:flex-row">
              <Button asChild variant="primary" size="md" className="shadow-lg">
                <Link to="/ingresar?tab=register&role=company">
                  EMPRESAS: PUBLICAR CARGA
                </Link>
              </Button>
              <Button asChild variant="dark" size="md" className="shadow-lg">
                <Link to="/ingresar?tab=register&role=carrier">
                  TRANSPORTISTAS: ENCONTRAR CARGA
                </Link>
              </Button>
            </div>
          </div>

          <ul className="space-y-4">
            {TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <CheckCircle
                  size={22}
                  className="mt-0.5 shrink-0 text-accent"
                  aria-hidden
                />
                <span className="text-base text-white/80">{point}</span>
              </li>
            ))}
            <li className="flex items-start gap-3 rounded-[10px] border border-white/10 bg-white/5 p-4">
              <ShieldCheck
                size={22}
                className="mt-0.5 shrink-0 text-brand-light"
                aria-hidden
              />
              <span className="text-sm text-white/70">
                Verificamos la identidad de cada transportista antes de que entre a la
                red, y cada viaje queda registrado en el historial de la carga.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
