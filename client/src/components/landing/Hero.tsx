import { Link } from "react-router-dom";
import { Button } from "../Button";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-brand-deep pb-48 pt-20 lg:pb-64 lg:pt-28">
      <div className="absolute inset-0 opacity-90">
        {/* webp a 1920px: 161 kB contra los 2.9 MB del jpg original, mismo
            recorte. El alt es vacío porque es decorativo: el texto del hero
            dice lo mismo. */}
        <img
          src="/hero.webp"
          alt=""
          aria-hidden
          width={1920}
          height={1072}
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-brand-deep via-brand-deep/90 to-brand/80 mix-blend-multiply" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8 lg:text-left">
        <div className="max-w-3xl">
          <h1 className="mb-6 font-display text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
            TRUCKPOOL: EL MARKETPLACE LOGÍSTICO PARA MOVER TU CARGA.
          </h1>
          <p className="mb-10 max-w-2xl text-lg text-white/70 sm:text-xl lg:mx-0">
            Conecta empresas con carga y transportistas con capacidad disponible. Reduce
            kilómetros vacíos, ahorra tiempo y dinero en una red verificada.
          </p>

          <div className="flex flex-col justify-center gap-4 sm:flex-row lg:justify-start">
            <Button asChild variant="dark" size="md" className="shadow-lg">
              <Link to="/ingresar?tab=register&role=company">
                EMPRESAS: PUBLICAR CARGA
              </Link>
            </Button>
            <Button asChild variant="primary" size="md" className="shadow-lg">
              <Link to="/ingresar?tab=register&role=carrier">
                TRANSPORTISTAS: ENCONTRAR CARGA
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
