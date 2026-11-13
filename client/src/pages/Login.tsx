import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import { api, setToken } from "../api/client";
import { safeReturnTo } from "../lib/returnTo";

type Tab = "login" | "register";
type Role = "COMPANY" | "CARRIER";

const inputClass = "input mt-1.5";

export default function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const initialRole: Role = params.get("role") === "carrier" ? "CARRIER" : "COMPANY";
  const initialTab: Tab =
    params.get("tab") === "register" &&
    (params.get("role") === "carrier" || params.get("role") === "company")
      ? "register"
      : "login";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(initialRole);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isRegister = tab === "register";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim().includes("@")) {
      setError("ingresá un email válido.");
      return;
    }
    // QW3: el mínimo de 8 es del registro; para acceder alcanza con que no esté
    // vacía (el server responde «email o contraseña incorrectos»)
    if (isRegister && password.length < 8) {
      setError("la contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (!password) {
      setError("ingresá tu contraseña.");
      return;
    }
    if (isRegister && !name.trim()) {
      setError("ingresá el nombre de la empresa o del fletero.");
      return;
    }

    setPending(true);
    api
      .post<{ token: string; user: { role: Role } }>(
        isRegister ? "/auth/register" : "/auth/login",
        isRegister
          ? { name: name.trim(), email: email.trim(), password, role }
          : { email: email.trim(), password }
      )
      .then((result) => {
        setToken(result.token);
        queryClient.invalidateQueries({ queryKey: ["me"] });
        // RD8: vuelve a la página desde la que se vino; si no hay, según el rol
        navigate(
          safeReturnTo(params.get("volver")) ??
            (result.user.role === "CARRIER" ? "/viajes/nuevo" : "/viajes"),
          { replace: true }
        );
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "algo salió mal, probá de nuevo.");
      })
      .finally(() => setPending(false));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-16 font-sans text-ink">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-6 shadow-[0_16px_40px_-28px_rgba(11,61,92,0.55)] sm:p-8">
        <Logo />
        <h1 className="mt-8 font-display text-[28px] leading-tight font-semibold">
          {isRegister ? "Creá tu cuenta" : "Ingresá a TruckPool"}
        </h1>

        <div className="mt-6 grid grid-cols-2 border-b border-line text-center text-[15px]">
          <button
            type="button"
            onClick={() => setTab("login")}
            aria-pressed={tab === "login"}
            className={`min-h-11 px-3 transition-colors ${
              tab === "login"
                ? "font-semibold text-brand shadow-[inset_0_-3px_0_var(--color-brand)]"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            Ingresar
          </button>
          <button
            type="button"
            onClick={() => setTab("register")}
            aria-pressed={tab === "register"}
            className={`min-h-11 px-3 transition-colors ${
              tab === "register"
                ? "font-semibold text-brand shadow-[inset_0_-3px_0_var(--color-brand)]"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            Crear cuenta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6">
          {isRegister && (
            <div className="mt-4">
              <label className="field-label" htmlFor="name">
                Nombre de empresa o fletero
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej: Comercial Norte"
                autoComplete="organization"
                className={inputClass}
              />
            </div>
          )}

          <div className={isRegister ? "mt-4" : "mt-0"}>
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@empresa.com"
              autoComplete="email"
              className={inputClass}
            />
          </div>

          {isRegister && (
            <div className="mt-4">
              <label className="field-label" htmlFor="role">
                Rol
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className={inputClass}
              >
                <option value="COMPANY">empresa — quiero mandar carga</option>
                <option value="CARRIER">fletero — tengo espacio en el camión</option>
              </select>
            </div>
          )}

          <div className="mt-4">
            <label className="field-label" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              // QW3: el gestor de contraseñas completa la guardada al acceder y
              // propone una nueva al crear la cuenta
              autoComplete={isRegister ? "new-password" : "current-password"}
              placeholder={isRegister ? "mínimo 8 caracteres" : undefined}
              className={inputClass}
            />
          </div>

          {error && <p className="mt-4 text-[13px] text-danger">{error}</p>}

          <Button type="submit" size="md" className="mt-6 w-full" disabled={pending}>
            {pending ? "un momento…" : isRegister ? "Crear cuenta" : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
