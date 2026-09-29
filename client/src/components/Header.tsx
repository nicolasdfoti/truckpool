import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "./Button";
import { Logo } from "./Logo";
import { Menu, X } from "./icons";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import { useAuth } from "../hooks/useAuth";
import { SkeletonBar } from "./Loading";

const NAV_LINKS = [
  { label: "Inicio", to: "/" },
  { label: "Viajes disponibles", to: "/viajes" },
  { label: "Fleteros", to: "/fleteros" },
  { label: "Rastrear envío", to: "/rastrear" },
  { label: "Nosotros", to: "/nosotros" },
];

function NavLink({ label, to }: { label: string; to: string }) {
  return (
    <Link
      to={to}
      className="relative font-semibold text-brand px-2 py-1 transition-colors hover:text-brand-hover after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:origin-left after:scale-x-0 after:bg-brand after:transition-transform after:duration-200 hover:after:scale-x-100"
    >
      {label}
    </Link>
  );
}

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const { user, isLoading, logout } = useAuth();

  // Detectar scroll para sombra
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  // Renderizado de esqueleto mientras carga la sesión
  if (isLoading) {
    return (
      <header
        className={`sticky top-0 z-50 bg-white shadow-sm transition-shadow duration-200 ${
          scrolled ? "shadow-md" : "shadow-sm"
        }`}
      >
        <div className="mx-auto max-w-screen-2xl px-6 lg:px-10">
          <div className="flex h-20 items-center justify-between gap-6">
            <div className="flex-shrink-0">
              <Logo />
            </div>
            <nav className="hidden lg:flex items-center gap-8" aria-label="Navegación principal">
              {NAV_LINKS.map((link) => (
                <NavLink key={link.label} label={link.label} to={link.to} />
              ))}
            </nav>
            <div className="hidden lg:flex items-center gap-3">
              <NotificationBell />
              <SkeletonBar className="h-8 w-24" />
              <SkeletonBar className="h-8 w-20" />
            </div>
            <div className="lg:hidden flex items-center gap-2">
              <NotificationBell />
              <SkeletonBar className="h-8 w-20" />
              <SkeletonBar className="h-8 w-8 rounded-full" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label={mobileOpen ? "cerrar menú" : "abrir menú"}
                aria-expanded={mobileOpen}
                aria-controls="menu-movil"
              >
                <X size={24} />
              </Button>
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header
      className={`sticky top-0 z-50 bg-white shadow-sm transition-shadow duration-200 ${
        scrolled ? "shadow-md" : "shadow-sm"
      }`}
    >
      <div className="mx-auto max-w-screen-2xl px-6 lg:px-10">
        <div className="flex h-20 items-center justify-between gap-6">
          {/* Logo a la izquierda. El Logo ya es un <Link to="/">: envolverlo
              en otro Link generaba <a> dentro de <a>. */}
          <div className="flex-shrink-0">
            <Logo />
          </div>

          {/* Nav principal centrada (desktop) */}
          <nav
            className="hidden lg:flex items-center gap-8"
            aria-label="Navegación principal"
          >
            {NAV_LINKS.map((link) => (
              <NavLink key={link.label} label={link.label} to={link.to} />
            ))}
          </nav>

          {/* Acciones a la derecha */}
          <div className="hidden lg:flex items-center gap-3">
            {user ? (
              <>
                {/* Campana de notificaciones */}
                <NotificationBell />

                {/* Botón publicar viaje - CTA principal para CARRIER */}
                {user.role === "CARRIER" && (
                  <Button asChild variant="primary" size="sm">
                    <Link to="/viajes/nuevo">Publicar viaje</Link>
                  </Button>
                )}

                {/* Menú de usuario */}
                <UserMenu
                  user={{ name: user.name, role: user.role }}
                  onLogout={handleLogout}
                />
              </>
            ) : (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link to="/ingresar">Iniciar Sesión</Link>
                </Button>
                <Button asChild variant="primary" size="sm">
                  <Link to="/ingresar?tab=register&role=company">Registrarse</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <div className="lg:hidden flex items-center gap-2">
            <NotificationBell />
            {user?.role === "CARRIER" && (
              <Button asChild variant="primary" size="sm">
                <Link to="/viajes/nuevo">Publicar viaje</Link>
              </Button>
            )}
            {/* bajo lg el menú se reduce al avatar (el nombre y el chevron
                se ocultan solos con lg:block dentro de UserMenu) */}
            {user && (
              <UserMenu
                user={{ name: user.name, role: user.role }}
                onLogout={handleLogout}
              />
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? "cerrar menú" : "abrir menú"}
              aria-expanded={mobileOpen}
              aria-controls="menu-movil"
            >
              {mobileOpen ? <X size={24} /> : <Menu size={24} />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          id="menu-movil"
          className="lg:hidden border-t border-line bg-white px-4 pb-6 pt-2 shadow-lg"
        >
          <nav className="space-y-1" aria-label="Navegación móvil">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className="block rounded-md px-3 py-3 text-base font-medium text-brand hover:bg-canvas transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
            {user ? (
              <>
                <div className="px-3 py-2 border-b border-line">
                  <p className="text-sm font-medium text-ink truncate">{user.name}</p>
                  <p className="text-[12px] text-ink-muted capitalize">{user.role}</p>
                </div>

                {user.role === "CARRIER" && (
                  <Button
                    asChild
                    variant="primary"
                    size="md"
                    className="w-full"
                    onClick={() => setMobileOpen(false)}
                  >
                    <Link to="/viajes/nuevo">publicar viaje</Link>
                  </Button>
                )}

                <Button
                  asChild
                  variant="outline"
                  size="md"
                  className="w-full"
                  onClick={() => setMobileOpen(false)}
                >
                  <Link to="/perfil">Mi perfil</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="md"
                  className="w-full"
                  onClick={() => setMobileOpen(false)}
                >
                  <Link to="/solicitudes">Solicitudes</Link>
                </Button>
                {user.role === "ADMIN" && (
                  <>
                    <Button
                      asChild
                      variant="outline"
                      size="md"
                      className="w-full"
                      onClick={() => setMobileOpen(false)}
                    >
                      <Link to="/admin">Dashboard</Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      size="md"
                      className="w-full"
                      onClick={() => setMobileOpen(false)}
                    >
                      <Link to="/admin/verificaciones">Verificaciones</Link>
                    </Button>
                  </>
                )}
                <div className="pt-2 border-t border-line">
                  <Button
                    variant="outline"
                    size="md"
                    className="w-full text-danger"
                    onClick={handleLogout}
                  >
                    Cerrar sesión
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Button
                  asChild
                  variant="outline"
                  size="md"
                  className="w-full"
                  onClick={() => setMobileOpen(false)}
                >
                  <Link to="/ingresar">Iniciar Sesión</Link>
                </Button>
                <Button
                  asChild
                  variant="primary"
                  size="md"
                  className="w-full"
                  onClick={() => setMobileOpen(false)}
                >
                  <Link to="/ingresar?tab=register&role=company">Registrarse</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}