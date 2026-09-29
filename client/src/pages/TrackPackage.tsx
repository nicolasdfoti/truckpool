import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { usePublicTracking } from "../hooks/useTripStops";
import { LoadingBlock, SkeletonBar } from "../components/Loading";

function formatTripDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatTime(time: string | null): string {
  if (!time) return "sin hora confirmada";
  return time;
}

function statusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case "PENDING":
      return { label: "pendiente de confirmar", className: "bg-brand/10 text-brand" };
    case "CONFIRMED":
      return { label: "confirmada", className: "bg-success-bg text-success-deep" };
    case "CANCELLED":
      return { label: "retirada", className: "bg-canvas-line text-ink-soft" };
    default:
      return { label: status.toLowerCase(), className: "bg-canvas-line text-ink-soft" };
  }
}

function tripStatusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case "OPEN":
      return { label: "abierto a cargas", className: "bg-brand/10 text-brand" };
    case "FULL":
      return { label: "completo", className: "bg-brand/10 text-brand" };
    case "IN_TRANSIT":
      return { label: "en viaje", className: "bg-success-bg text-success-deep" };
    case "COMPLETED":
      return { label: "completado", className: "bg-canvas-line text-ink-soft" };
    default:
      return { label: status.toLowerCase(), className: "bg-canvas-line text-ink-soft" };
  }
}

export default function TrackPackage() {
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const {
    data: tracking,
    isLoading,
    isError,
  } = usePublicTracking(code.trim().toUpperCase());

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 3) return;
    setSubmitted(true);
  };

  const handleClear = () => {
    setCode("");
    setSubmitted(false);
  };

  if (submitted && isLoading) {
    return (
      <div className="bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-xl px-4 py-12">
          <Link
            to="/rastrear"
            className="text-sm text-brand underline"
            onClick={handleClear}
          >
            ← buscar otro código
          </Link>
          <LoadingBlock label="buscando envío" className="mt-8 space-y-4">
            <SkeletonBar className="h-7 w-1/2" />
            <SkeletonBar className="h-4 w-1/3" />
            <SkeletonBar className="h-64 w-full" />
          </LoadingBlock>
        </main>
      </div>
    );
  }

  if (submitted && (isError || !tracking)) {
    return (
      <div className="bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-xl px-4 py-12">
          <Link
            to="/rastrear"
            className="text-sm text-brand underline"
            onClick={handleClear}
          >
            ← buscar otro código
          </Link>
          <div className="mt-8 rounded-[10px] border border-line bg-white p-6 text-center">
            <h2 className="font-display text-xl font-medium">código no encontrado</h2>
            <p className="mt-2 text-sm text-ink-muted">
              no existe ningún envío con el código{" "}
              <code className="font-mono">{code.toUpperCase()}</code>.
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              verificá que lo hayas copiado bien (formato: TP-XXXX-C#).
            </p>
            <Button asChild variant="outline" size="md" className="mt-4">
              <Link to="/rastrear" onClick={handleClear}>
                buscar otro código
              </Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-xl px-4 py-12">
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-brand underline">
              ← volver al inicio
            </Link>
            <label htmlFor="trackingCode" className="sr-only">
              código de seguimiento
            </label>
            <input
              id="trackingCode"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="TP-XXXX-C#"
              inputMode="text"
              autoComplete="off"
              className="flex-1 rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand font-mono"
              disabled={submitted}
            />
            <Button type="submit" size="md" disabled={!code.trim() || submitted}>
              {submitted ? "buscando…" : "rastrear"}
            </Button>
            {submitted && (
              <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
                limpiar
              </Button>
            )}
          </div>
        </form>

        {tracking && (
          <div className="space-y-6">
            <div className="rounded-[10px] border border-line bg-white p-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[12px] text-ink-muted font-mono">
                    {tracking.trackingCode}
                  </p>
                  <h1 className="mt-1 font-display text-xl font-medium">
                    {tracking.description}
                  </h1>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusLabel(tracking.cargoStatus).className}`}
                >
                  {statusLabel(tracking.cargoStatus).label}
                </span>
              </div>
            </div>

            <div className="rounded-[10px] border border-line bg-white p-6">
              <h2 className="font-display text-base font-medium">recorrido del viaje</h2>
              <div className="mt-3 flex items-center gap-2 text-sm text-ink-soft flex-wrap">
                <span className="font-medium text-ink">{tracking.trip.origin}</span>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-ink-muted flex-shrink-0"
                  aria-hidden
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                <span className="font-medium text-ink">{tracking.trip.destination}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-[13px] text-ink-muted">
                <span>
                  fecha:{" "}
                  <span className="text-ink font-medium">
                    {formatTripDate(tracking.trip.date)}
                  </span>
                </span>
                <span>
                  salida:{" "}
                  <span className="text-ink font-medium">
                    {formatTime(tracking.trip.departureTime)}
                  </span>
                </span>
              </div>
            </div>

            <div className="rounded-[10px] border border-line bg-white p-6">
              <h2 className="font-display text-base font-medium">estado del viaje</h2>
              <div className="mt-3">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${tripStatusLabel(tracking.trip.status).className}`}
                >
                  {tripStatusLabel(tracking.trip.status).label}
                </span>
              </div>
            </div>

            <div className="rounded-[10px] border border-surface-line bg-surface p-6 text-center">
              <p className="text-sm text-ink-muted">
                este es un seguimiento público: no muestra direcciones exactas de retiro,
                precios ni datos de la empresa.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
