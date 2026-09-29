import { Hero } from "../components/landing/Hero";
import { AudienceCards } from "../components/landing/AudienceCards";
import { HowItWorks } from "../components/landing/HowItWorks";
import { Benefits } from "../components/landing/Benefits";
import { TestimonialCarousel } from "../components/landing/TestimonialCarousel";
import { ClosingCta } from "../components/landing/ClosingCta";

export default function Home() {
  return (
    // el Layout no dibuja <main> porque las páginas lo hacen por su cuenta;
    // esta es la landing, asi que le corresponde a ella.
    <main className="bg-canvas font-sans selection:bg-canvas-line">
      <Hero />
      <AudienceCards />
      <HowItWorks />
      <Benefits />
      {/* Social proof: va despues de explicar el producto y sus ventajas, que es
          cuando el visitante ya sabe que es TruckPool y la opinion le sirve. */}
      <TestimonialCarousel />
      {/* Cierre con accion: el Hero abre con CTAs y la pagina terminaba sin
          ninguna salida. */}
      <ClosingCta />
    </main>
  );
}
