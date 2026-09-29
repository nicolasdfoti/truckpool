import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "./Button";
import { ChevronDown, User, ClipboardList, LogOut } from "./icons";

type UserMenuProps = {
  user: {
    name: string;
    role: "CARRIER" | "COMPANY" | "ADMIN";
  };
  onLogout: () => void;
};

/** "Transportes del Norte" -> "TN"; si no hay nombre, nunca queda vacío. */
function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Menú de usuario: disparador con avatar de iniciales + nombre + chevron
 * (sólo avatar bajo lg) y panel con perfil, solicitudes y cerrar sesión.
 * Arranca cerrado; cierra con click fuera, Escape o al navegar.
 */
export function UserMenu({ user, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cerrar con Escape y devolver el foco al disparador
  useEffect(() => {
    if (!open) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  const handleNavigate = (to: string) => {
    navigate(to);
    setOpen(false);
  };

  const label = initials(user.name);
  const roleLabel =
    user.role === "CARRIER" ? "fletero" : user.role === "COMPANY" ? "empresa" : "admin";

  const rowClass =
    "w-full justify-start gap-3 rounded-none px-3 py-2 text-left text-sm text-ink! hover:bg-canvas";

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        className="gap-2 rounded-md px-2 py-1.5 hover:bg-canvas"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`menú de ${user.name || "usuario"}`}
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white"
        >
          {label}
        </span>
        <span className="hidden max-w-[140px] truncate text-left text-sm font-medium text-ink lg:block">
          {user.name}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={`hidden shrink-0 text-ink-muted transition-transform duration-200 lg:block ${open ? "rotate-180" : ""}`}
        />
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={dropdownRef}
            className="absolute right-0 mt-2 w-60 origin-top-right rounded-[10px] border border-line bg-white shadow-lg z-50"
            role="menu"
            aria-label="menú de usuario"
          >
            <div className="border-b border-line px-4 py-3">
              <p className="truncate text-sm font-medium text-ink">{user.name}</p>
              <p className="text-xs capitalize text-ink-muted">{roleLabel}</p>
            </div>

            <nav className="py-1" role="menu">
              <Button
                variant="ghost"
                size="sm"
                className={rowClass}
                role="menuitem"
                onClick={() => handleNavigate("/perfil")}
              >
                <User size={16} className="shrink-0 text-ink-muted" aria-hidden />
                mi perfil
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className={rowClass}
                role="menuitem"
                onClick={() => handleNavigate("/solicitudes")}
              >
                <ClipboardList
                  size={16}
                  className="shrink-0 text-ink-muted"
                  aria-hidden
                />
                solicitudes
              </Button>
            </nav>

            <div className="border-t border-line p-1">
              <Button
                variant="danger"
                size="sm"
                className="w-full justify-start gap-3 rounded-none px-3 py-2 text-left text-sm hover:bg-canvas"
                role="menuitem"
                onClick={onLogout}
              >
                <LogOut size={16} className="shrink-0" aria-hidden />
                salir
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
