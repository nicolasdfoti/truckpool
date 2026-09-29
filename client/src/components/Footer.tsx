import { Link } from "react-router-dom";
import { Logo } from "./Logo";
import { Facebook, Instagram, Linkedin, Twitter } from "./icons";

const FOOTER_LINKS = [
  { label: "Inicio", to: "/" },
  { label: "Para Empresas" },
  { label: "Para Transportistas" },
  { label: "Precios" },
  { label: "Rastrear envío", to: "/rastrear" },
  { label: "Nosotros", to: "/nosotros" },
];

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-brand-deep py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between space-y-6 md:flex-row md:space-y-0">
          <Logo light />

          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4 text-sm font-medium text-ink-muted">
            {FOOTER_LINKS.map((link) =>
              link.to ? (
                <Link
                  key={link.label}
                  to={link.to}
                  className="transition-colors hover:text-white"
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.label}
                  href="#"
                  className="transition-colors hover:text-white"
                >
                  {link.label}
                </a>
              )
            )}
          </div>

          <div className="flex space-x-5 text-ink-muted">
            <a
              href="#"
              aria-label="Instagram"
              className="transition-colors hover:text-white"
            >
              <Instagram size={20} />
            </a>
            <a
              href="#"
              aria-label="Facebook"
              className="transition-colors hover:text-white"
            >
              <Facebook size={20} />
            </a>
            <a
              href="#"
              aria-label="Twitter"
              className="transition-colors hover:text-white"
            >
              <Twitter size={20} />
            </a>
            <a
              href="#"
              aria-label="LinkedIn"
              className="transition-colors hover:text-white"
            >
              <Linkedin size={20} />
            </a>
          </div>
        </div>

        <div className="mt-8 border-t border-white/10 pt-8 text-center text-sm text-ink-muted">
          &copy; 2026 TruckPool. Todos los derechos reservados. Desarrollado como proyecto
          full-stack profesional.
        </div>
      </div>
    </footer>
  );
}
