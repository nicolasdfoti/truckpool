import { Link } from "react-router-dom";
import { Button } from "../Button";

const STEPS = [
  ["Publicás", "el recorrido, la fecha y el precio. Te sugerimos uno según los km."],
  ["Confirmás", "cada carga antes de salir y ordenás las paradas de retiro."],
  ["Cobrás", "la seña cuando reservan y el saldo cuando salís."],
];

/** el fletero en una banda propia: su acción va en contorno, el naranja es de la empresa */
export function CarrierBand() {
  return (
    <section
      aria-labelledby="fleteros-titulo"
      className="mt-16 bg-brand py-10 text-white sm:mt-24 sm:py-16"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[5fr_7fr]">
        <div>
          <h2
            id="fleteros-titulo"
            className="font-display text-[clamp(26px,3vw,34px)] leading-tight font-semibold"
          >
            ¿Tenés un camión que sale con lugar?
          </h2>
          <p className="mt-3 max-w-[44ch] text-[17px] text-brand-tint">
            Publicá el viaje con el espacio que te sobra. Las empresas reservan por m³ y
            cobrás en tu cuenta de Mercado Pago.
          </p>
          <Button asChild variant="outline-light" className="mt-6 border-white">
            <Link to="/viajes/nuevo">Publicar mi viaje</Link>
          </Button>
        </div>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(([what, rest]) => (
            <li key={what} className="border-t-2 border-white/40 pt-3">
              <strong className="block font-display text-[17px] font-semibold">
                {what}
              </strong>
              <span className="text-[15px] text-brand-tint">{rest}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
