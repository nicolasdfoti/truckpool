import { Section } from "./Section";

// es una secuencia real (buscar → reservar → seguir): por eso va numerada
const STEPS = [
  {
    title: "Buscá un viaje",
    body: "Filtrá por origen, destino y fecha. Cada viaje muestra cuánto lugar le queda y el precio por m³.",
  },
  {
    title: "Reservá y pagá la seña",
    body: "Elegís los m³ que necesitás y dejás la dirección de retiro. El lugar es tuyo por 24 h hasta que pagás la seña.",
  },
  {
    title: "Seguí tu carga",
    body: "El fletero confirma, pasa a retirar y sale. Con el código de seguimiento ves en qué está tu envío.",
  },
];

export function HowItWorks() {
  return (
    <Section id="como-funciona" title="Cómo funciona">
      <ol className="lp-steps">
        {STEPS.map((s) => (
          <li key={s.title}>
            <h3 className="font-display text-[19px] font-semibold">{s.title}</h3>
            <p className="mt-2 text-ink-soft">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
