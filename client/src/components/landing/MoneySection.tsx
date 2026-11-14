import { Section } from "./Section";

// las mismas ventanas que server/lib/cancellation.ts
const REFUNDS = [
  ["Más de 48 h antes de la salida", "te devolvemos toda la seña"],
  ["Entre 24 y 48 h antes", "la mitad"],
  ["Menos de 24 h antes", "no hay devolución"],
  ["Si el viaje se cancela", "toda la seña"],
];

export function MoneySection() {
  return (
    <Section
      id="tu-plata"
      title="Qué pasa con tu plata"
      lead="Pagás en dos partes y siempre sabés cuánto se devuelve si cambiás de planes."
    >
      <div className="grid gap-10 rounded-xl bg-white px-4 py-6 sm:p-10 lg:grid-cols-[7fr_5fr]">
        <div>
          <h3 className="font-display text-[19px] font-semibold">
            Así se reparte el pago
          </h3>
          <p className="mt-2 text-ink-soft">Ejemplo: 4 m³ a $ 100 por m³ son $ 400.</p>
          <div
            role="img"
            aria-label="seña de $ 80, el 20 %, y saldo de $ 320, el 80 %"
            className="mt-6 grid gap-4 sm:grid-cols-[20fr_80fr] sm:gap-0"
          >
            <div className="border-t-[10px] border-brand pt-3">
              <p className="font-semibold">Seña, 20 %</p>
              <p className="font-display text-2xl font-semibold">$ 80</p>
              <p className="text-sm text-ink-soft">dentro de las 24 h de reservar</p>
            </div>
            <div className="border-t-[10px] border-brand-tint pt-3 sm:pl-3">
              <p className="font-semibold">Saldo</p>
              <p className="font-display text-2xl font-semibold">$ 320</p>
              <p className="text-sm text-ink-soft">cuando sale el viaje</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            Cada fletero elige la seña de su viaje, entre el 10 y el 50 %. La ves antes de
            reservar.
          </p>
        </div>
        <div>
          <h3 className="font-display text-[19px] font-semibold">Si retirás tu carga</h3>
          <table className="mt-4 w-full border-collapse text-[15px]">
            <tbody>
              {REFUNDS.map(([when, what]) => (
                <tr key={when} className="border-b border-line last:border-b-0">
                  <th
                    scope="row"
                    className="py-3 pr-4 text-left align-top font-normal text-ink-soft"
                  >
                    {when}
                  </th>
                  <td className="py-3 text-right align-top font-semibold">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
