import { useState, useEffect } from "react";
import { Link, NavLink as RouterNavLink, useNavigate } from "react-router-dom";
import { Button } from "./Button";
import { Logo } from "./Logo";
import { Menu, X } from "./icons";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import { useAuth } from "../hooks/useAuth";
import { useLoginHref } from "../hooks/useLoginHref";
import { SkeletonBar } from "./Loading";

// el logo ya lleva al inicio: la nav arranca por lo que se busca
const NAV_LINKS = [
  { label: "Viajes", to: "/viajes" },
  { label: "Fleteros", to: "/fleteros" },
  { label: "Rastrear un envío", to: "/rastrear" },
  { label: "Nosotros", to: "/nosotros" },
];

// la página actual va subrayada en navy, pegada al borde del header
function NavLink({ label, to }: { label: string; to: string }) {
  return (
    <RouterNavLink
      to={to}
      end={to === "/viajes"}
      className={({ isActive }) =>
        `flex h-16 items-center border-b-2 px-1 text-[15px] font-medium transition-colors ${
          isActive
            ? "border-brand text-brand"
            : "border-transparent text-ink hover:text-brand"
        }`
      }
    >
      {label}
    </RouterNavLink>
  );
}

const HEADER_CLASS = "sticky top-0 z-50 border-b border-line bg-white transition-shadow";
const ROW_CLASS = "flex h-16 items-center justify-between gap-6";
const WRAP_CLASS = "mx-auto max-w-6xl px-4 sm:px-6";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const { user, isLoading, logout } = useAuth();
  // RD8: ingresar desde cualquier página vuelve a esa página
  const loginLink = useLoginHref();

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
      <header className={`${HEADER_CLASS} ${scrolled ? "shadow-sm" : ""}`}>
        <div className={WRAP_CLASS}>
          <div className={ROW_CLASS}>
            <div className="flex-shrink-0">
              <Logo />
            </div>
            <nav
              className="hidden flex-1 items-center gap-7 lg:flex"
              aria-label="Navegación principal"
            >
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
    <header className={`${HEADER_CLASS} ${scrolled ? "shadow-sm" : ""}`}>
      <div className={WRAP_CLASS}>
        <div className={ROW_CLASS}>
          {/* Logo a la izquierda. El Logo ya es un <Link to="/">: envolverlo
              en otro Link generaba <a> dentro de <a>. */}
          <div className="flex-shrink-0">
            <Logo />
          </div>

          {/* Nav principal centrada (desktop) */}
          <nav
            className="hidden flex-1 items-center gap-7 lg:flex"
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
                  <Button asChild variant="dark" size="sm">
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
                <Button asChild variant="ghost" size="sm" className="text-ink!">
                  <Link to={loginLink()}>Ingresar</Link>
                </Button>
                <Button asChild variant="dark" size="sm">
                  <Link to={loginLink({ tab: "register", role: "company" })}>
                    Crear cuenta
                  </Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <div className="lg:hidden flex items-center gap-2">
            <NotificationBell />
            {/* RD1: a menos de sm no entra junto a la campanita, el avatar y la
                hamburguesa (la página se ensanchaba y el menú quedaba afuera);
                ahí «publicar viaje» queda en el menú móvil */}
            {user?.role === "CARRIER" && (
              <span className="hidden sm:inline-flex">
                <Button asChild variant="dark" size="sm">
                  <Link to="/viajes/nuevo">Publicar viaje</Link>
                </Button>
              </span>
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
          className="border-t border-line bg-white px-4 pb-6 pt-2 shadow-sm lg:hidden"
        >
          <nav className="space-y-1" aria-label="Navegación móvil">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className="block rounded-lg px-3 py-3 text-base font-medium text-ink transition-colors hover:bg-canvas"
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
                  <p className="text-[13px] text-ink-soft">
                    {user.role === "CARRIER"
                      ? "fletero"
                      : user.role === "COMPANY"
                        ? "empresa"
                        : "admin"}
                  </p>
                </div>

                {user.role === "CARRIER" && (
                  <Button
                    asChild
                    variant="dark"
                    size="md"
                    className="w-full"
                    onClick={() => setMobileOpen(false)}
                  >
                    <Link to="/viajes/nuevo">Publicar viaje</Link>
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
                    variant="outline-danger"
                    size="md"
                    className="w-full"
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
                  <Link to={loginLink()}>Ingresar</Link>
                </Button>
                <Button
                  asChild
                  variant="dark"
                  size="md"
                  className="w-full"
                  onClick={() => setMobileOpen(false)}
                >
                  <Link to={loginLink({ tab: "register", role: "company" })}>
                    Crear cuenta
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
