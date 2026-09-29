import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import { api, setToken } from "../api/client";

type Tab = "login" | "register";
type Role = "COMPANY" | "CARRIER";

const inputClass =
  "mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand";

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
    if (password.length < 8) {
      setError("la contraseña debe tener al menos 8 caracteres.");
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
        navigate(result.user.role === "CARRIER" ? "/viajes/nuevo" : "/viajes");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "algo salió mal, probá de nuevo.");
      })
      .finally(() => setPending(false));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-16 font-sans text-ink">
      <div className="w-full max-w-md rounded-[12px] border border-line bg-white p-8">
        <Logo />

        <div className="mt-8 grid grid-cols-2 rounded-md border border-line p-1 text-center text-sm">
          <button
            type="button"
            onClick={() => setTab("login")}
            className={`rounded-md px-3 py-2 transition-colors ${
              tab === "login" ? "bg-brand text-white" : "text-ink-soft hover:text-ink"
            }`}
          >
            acceder
          </button>
          <button
            type="button"
            onClick={() => setTab("register")}
            className={`rounded-md px-3 py-2 transition-colors ${
              tab === "register" ? "bg-brand text-white" : "text-ink-soft hover:text-ink"
            }`}
          >
            crear cuenta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6">
          {isRegister && (
            <div className="mt-4">
              <label className="text-[13px] text-ink-soft" htmlFor="name">
                nombre de empresa o fletero
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej: Comercial Norte"
                className={inputClass}
              />
            </div>
          )}

          <div className={isRegister ? "mt-4" : "mt-0"}>
            <label className="text-[13px] text-ink-soft" htmlFor="email">
              email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@empresa.com"
              className={inputClass}
            />
          </div>

          {isRegister && (
            <div className="mt-4">
              <label className="text-[13px] text-ink-soft" htmlFor="role">
                rol
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
            <label className="text-[13px] text-ink-soft" htmlFor="password">
              contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 8 caracteres"
              className={inputClass}
            />
          </div>

          {error && <p className="mt-4 text-[13px] text-danger">{error}</p>}

          <Button type="submit" className="mt-6 w-full" disabled={pending}>
            {pending ? "un momento…" : isRegister ? "crear cuenta" : "entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
