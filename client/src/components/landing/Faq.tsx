import { Section } from "./Section";

// cada respuesta sale de una regla del server (verificación, D6, ventanas de
// retiro, pago en dos partes, seguimiento): si cambia la regla, cambia el texto
const QUESTIONS = [
  {
    q: "¿Cómo sé que el fletero es confiable?",
    a: "Solo pueden publicar fleteros con el DNI o CUIT revisado por nuestro equipo. En el perfil de cada uno ves las reseñas de las empresas que ya viajaron con él.",
  },
  {
    q: "¿Qué pasa si el viaje no sale?",
    a: "Si el fletero cancela, o si no sale dentro de las 24 h siguientes a la hora de salida, el viaje se cancela y te devolvemos toda la seña.",
  },
  {
    q: "¿Puedo retirar mi carga después de reservar?",
    a: "Sí. Con más de 48 h de anticipación te devolvemos toda la seña; entre 24 y 48 h, la mitad; con menos de 24 h, no hay devolución. Antes de confirmar ves cuánto te devolvemos.",
  },
  {
    q: "¿Cuánto pago en total?",
    a: "El precio por m³ del viaje por los m³ que reservás. Lo pagás en dos partes por Mercado Pago: la seña al reservar y el saldo cuando sale el viaje.",
  },
  {
    q: "¿Cómo sigo mi carga?",
    a: "Con el código de seguimiento, en «Rastrear un envío». Si tenés cuenta, en el mapa del viaje ves dónde va el camión mientras el fletero comparte su ubicación.",
  },
];

export function Faq() {
  return (
    <Section
      id="preguntas"
      title="Preguntas frecuentes"
      lead="Las reglas de TruckPool, en corto."
      split
    >
      <div className="lp-faq">
        {QUESTIONS.map((item, i) => (
          <details key={item.q} open={i === 0}>
            <summary>{item.q}</summary>
            <p className="max-w-[64ch] pb-4 text-ink-soft">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
