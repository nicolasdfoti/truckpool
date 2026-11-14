import { Link } from "react-router-dom";
import { Logo } from "./Logo";

// sólo links que llevan a algún lado: los de "#" y las redes sin perfil se fueron
const FOOTER_LINKS = [
  { label: "Viajes", to: "/viajes" },
  { label: "Fleteros", to: "/fleteros" },
  { label: "Rastrear un envío", to: "/rastrear" },
  { label: "Preguntas frecuentes", to: "/#preguntas" },
  { label: "Nosotros", to: "/nosotros" },
];

export function Footer() {
  return (
    <footer className="bg-brand-deep py-10 text-white/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <Logo light />
        <nav aria-label="Pie de página">
          <ul className="flex flex-wrap gap-x-6 gap-y-3 text-[15px]">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                <Link to={link.to} className="transition-colors hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-sm text-white/70">&copy; 2026 TruckPool</p>
      </div>
    </footer>
  );
}
