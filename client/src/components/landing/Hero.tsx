import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../Button";
import { HeroIllustration } from "./HeroIllustration";
import { Guarantees } from "./Guarantees";

type Tab = "empresa" | "fletero";
const TABS: { id: Tab; label: string }[] = [
  { id: "empresa", label: "Busco lugar para mi carga" },
  { id: "fletero", label: "Tengo un camión con lugar" },
];

/**
 * Hero 1 del rediseño: el buscador como acción principal y, en otra pestaña,
 * lo que hace el fletero. Se ve una pestaña por vez, así que hay un solo
 * naranja en pantalla. El buscador lleva a /viajes con los filtros en la URL
 * (`origen`, `destino`, `desde`), que el listado lee.
 */
export function Hero() {
  const [tab, setTab] = useState<Tab>("empresa");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    empresa: null,
    fletero: null,
  });
  const navigate = useNavigate();

  const select = (next: Tab) => {
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  // patrón de pestañas del APG: las flechas mueven la selección
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    select(tab === "empresa" ? "fletero" : "empresa");
  };

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["origen", "destino", "desde"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) params.set(key, value);
    }
    const query = params.toString();
    navigate(query ? `/viajes?${query}` : "/viajes");
  };

  return (
    <section className="bg-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-16">
        <div>
          <h1 className="font-display text-[clamp(34px,4.4vw,52px)] leading-[1.08] font-semibold text-ink">
            Mandá tu carga en camiones que ya viajan.
          </h1>
          <p className="mt-4 max-w-[44ch] text-lg text-ink-soft">
            Reservás los m³ que necesitás a precio fijo, con fleteros verificados y pago
            por Mercado Pago.
          </p>

          <div className="mt-10 rounded-xl border border-line bg-white shadow-[0_16px_40px_-28px_rgba(11,61,92,0.55)]">
            <div
              role="tablist"
              aria-label="qué querés hacer"
              className="grid grid-cols-2 border-b border-line"
            >
              {TABS.map((t) => {
                const selected = tab === t.id;
                return (
                  <button
                    key={t.id}
                    ref={(el) => {
                      tabRefs.current[t.id] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={selected}
                    aria-controls={`panel-${t.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(t.id)}
                    onKeyDown={onTabKey}
                    className={`min-h-[52px] rounded-t-xl px-3 text-sm sm:text-[15px] ${
                      selected
                        ? "bg-white font-semibold text-brand shadow-[inset_0_-3px_0_var(--color-brand)]"
                        : "bg-soft font-medium text-ink-soft hover:text-ink"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <form
              role="tabpanel"
              id="panel-empresa"
              aria-labelledby="tab-empresa"
              hidden={tab !== "empresa"}
              onSubmit={onSearch}
              className="grid gap-3 p-4 sm:p-6"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="field-label">Origen</span>
                  <input
                    name="origen"
                    className="input min-h-12"
                    placeholder="Ej.: Córdoba"
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span className="field-label">Destino</span>
                  <input
                    name="destino"
                    className="input min-h-12"
                    placeholder="Ej.: Mendoza"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
                <label className="min-w-0">
                  <span className="field-label">Desde el</span>
                  <input name="desde" type="date" className="input min-h-12" />
                </label>
                <Button type="submit" className="min-h-[52px] text-base">
                  Buscar viajes
                </Button>
              </div>
              <p className="text-sm text-ink-soft">
                O mirá{" "}
                <Link to="/viajes" className="font-medium text-brand underline">
                  todos los viajes publicados
                </Link>
                .
              </p>
            </form>

            <div
              role="tabpanel"
              id="panel-fletero"
              aria-labelledby="tab-fletero"
              hidden={tab !== "fletero"}
              className="p-4 sm:p-6"
            >
              <p className="mb-4 text-ink-soft">
                Publicá el viaje con el espacio que te sobra. Las empresas reservan por m³
                y cobrás en tu cuenta de Mercado Pago.
              </p>
              <Button asChild className="min-h-[52px] text-base">
                <Link to="/viajes/nuevo">Publicar mi viaje</Link>
              </Button>
              <p className="mt-3 text-sm text-ink-soft">
                Para publicar necesitás tu DNI o CUIT verificado y tu cuenta de Mercado
                Pago conectada.
              </p>
            </div>
          </div>
        </div>

        <HeroIllustration />
      </div>
      <Guarantees />
    </section>
  );
}
