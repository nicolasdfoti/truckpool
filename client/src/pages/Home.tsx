import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Hero } from "../components/landing/Hero";
import { UpcomingTrips } from "../components/landing/UpcomingTrips";
import { HowItWorks } from "../components/landing/HowItWorks";
import { MoneySection } from "../components/landing/MoneySection";
import { CarrierBand } from "../components/landing/CarrierBand";
import { Faq } from "../components/landing/Faq";
import "../components/landing/landing.css";

export default function Home() {
  const { hash } = useLocation();

  // el pie lleva a /#preguntas: el router no baja solo hasta el ancla
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    // el Layout no dibuja <main> porque las páginas lo hacen por su cuenta;
    // esta es la landing, así que le corresponde a ella.
    <main className="bg-canvas pb-16 font-sans sm:pb-24">
      <Hero />
      <UpcomingTrips />
      <HowItWorks />
      <MoneySection />
      <CarrierBand />
      <Faq />
    </main>
  );
}
