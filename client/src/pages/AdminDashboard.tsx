import { Navigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { LoadingBlock, SkeletonList } from "../components/Loading";
import { useAdminStats, type AdminStats } from "../hooks/useAdminStats";

type Card = {
  label: string;
  value: number | null;
  hint: string;
  reason?: string;
  format?: (value: number) => string;
};

function formatNumber(value: number) {
  return value.toLocaleString("es-AR");
}

function formatMoney(value: number) {
  return value.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function formatVolume(value: number) {
  return `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })} m³`;
}

function formatRating(value: number) {
  return value.toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

function cards(stats: AdminStats): Card[] {
  const reason = (field: string, fallback: string) =>
    stats.pendingReasons[field] ?? fallback;

  return [
    {
      label: "viajes totales",
      value: stats.totalTrips,
      hint: "publicados en la plataforma",
      format: formatNumber,
    },
    {
      label: "volumen transportado",
      value: stats.volumeTransported,
      hint: "cargas confirmadas",
      format: formatVolume,
    },
    {
      label: "monto facturado",
      value: stats.billedAmount,
      hint: "pagos aprobados",
      reason: reason("billedAmount", "fase de pagos no implementada"),
      format: formatMoney,
    },
    {
      label: "rating promedio",
      value: stats.averageRating,
      hint: "sobre 5 puntos",
      reason: reason("averageRating", "fase de reviews no implementada"),
      format: formatRating,
    },
    {
      label: "transportistas activos",
      value: stats.activeCarriers,
      hint: "con al menos un viaje",
      format: formatNumber,
    },
    {
      label: "empresas activas",
      value: stats.activeCompanies,
      hint: "con al menos una carga",
      format: formatNumber,
    },
  ];
}

const STATUS_LABELS: [keyof AdminStats["tripsByStatus"], string][] = [
  ["OPEN", "abiertos"],
  ["FULL", "completos"],
  ["IN_TRANSIT", "en tránsito"],
  ["COMPLETED", "finalizados"],
];

export default function AdminDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const stats = useAdminStats(isAdmin);

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />;

  const data = stats.data;

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">
          métricas reales calculadas sobre los viajes, las cargas, los pagos y las
          calificaciones de la plataforma.
        </p>

        {isAdmin && stats.isLoading && (
          <LoadingBlock label="calculando métricas" className="mt-8">
            <SkeletonList count={3} />
          </LoadingBlock>
        )}

        {isAdmin && stats.isError && (
          <p className="mt-6 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {stats.error instanceof Error
              ? stats.error.message
              : "no pudimos cargar las métricas."}
          </p>
        )}

        {isAdmin && data && (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards(data).map((card) => {
                const { value } = card;
                return (
                  <div
                    key={card.label}
                    className="rounded-[10px] border border-line bg-white p-6"
                  >
                    <p className="text-[13px] uppercase tracking-wide text-ink-muted">
                      {card.label}
                    </p>
                    {value === null ? (
                      <>
                        <p className="mt-2 font-display text-3xl font-semibold text-ink-muted">
                          próximamente
                        </p>
                        <p className="mt-1 text-[13px] text-ink-muted">
                          {card.reason ?? "fase pendiente"}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="mt-2 font-display text-4xl font-semibold text-brand">
                          {card.format ? card.format(value) : formatNumber(value)}
                        </p>
                        <p className="mt-1 text-[13px] text-ink-muted">{card.hint}</p>
                      </>
                    )}
                  </div>
                );
              })}
            </section>

            <section className="mt-8 rounded-[10px] border border-line bg-white p-6">
              <h2 className="font-display text-[17px] font-medium">viajes por estado</h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {STATUS_LABELS.map(([status, label]) => (
                  <div key={status}>
                    <dt className="text-[13px] uppercase tracking-wide text-ink-muted">
                      {label}
                    </dt>
                    <dd className="mt-1 font-display text-2xl font-semibold">
                      {data.tripsByStatus[status].toLocaleString("es-AR")}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="mt-8 rounded-[10px] border border-line bg-white p-6">
              <h2 className="font-display text-[17px] font-medium">notas</h2>
              <ul className="mt-3 grid gap-2">
                {data.notes.map((note) => (
                  <li key={note} className="text-[13px] text-ink-soft">
                    {note}
                  </li>
                ))}
              </ul>
            </section>

            <p className="mt-8 text-sm">
              <Link to="/admin/verificaciones" className="text-brand underline">
                ir a verificaciones de identidad
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
