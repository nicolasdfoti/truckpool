import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { RatingStars } from "../components/RatingInput";
import { Truck } from "../components/icons";
import { useCarriers } from "../hooks/useUserProfile";
import { useAuth } from "../hooks/useAuth";
import { SkeletonList } from "../components/Loading";
import { useCreateTripRequest } from "../hooks/useTripRequests";

export default function Carriers() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: carriers, isLoading, isError } = useCarriers();
  const createTripRequest = useCreateTripRequest();

  function handleRequestClick(carrierId: string, carrierName: string) {
    navigate(
      `/solicitudes?action=request&carrierId=${carrierId}&carrierName=${encodeURIComponent(carrierName)}`
    );
  }

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <h1 className="font-display text-[clamp(28px,3.4vw,36px)] leading-tight font-semibold">
          Fleteros
        </h1>
        <p className="mt-2 text-[17px] text-ink-soft">
          Conocé a los fleteros que publican en TruckPool y pediles un viaje directo.
        </p>

        {isLoading && <SkeletonList count={6} className="mt-8" />}

        {isError && (
          <p className="mt-10 rounded-md border border-line bg-white p-4 text-sm text-danger">
            no pudimos cargar los transportistas. probá de nuevo en un rato.
          </p>
        )}

        {carriers && carriers.length === 0 && (
          <div className="mt-16 flex flex-col items-center text-center">
            <Truck className="h-10 w-10 text-ink-muted" aria-hidden />
            <p className="mt-4 text-sm text-ink-soft">
              todavía no hay transportistas publicando.
            </p>
            <Button asChild variant="primary" size="sm" className="mt-4">
              <Link to="/ingresar?tab=register&role=carrier">
                Registrate como fletero
              </Link>
            </Button>
          </div>
        )}

        {carriers && carriers.length > 0 && (
          <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {carriers.map((carrier) => (
              <li
                key={carrier.id}
                className="flex flex-col rounded-xl border border-line bg-white p-5 sm:p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand">
                    <Truck className="h-5 w-5" aria-hidden />
                  </span>
                  <p className="min-w-0 flex-1 font-display text-lg leading-tight font-semibold">
                    {carrier.name}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-soft">
                  <span>
                    {carrier.openTrips === 1
                      ? "1 viaje abierto"
                      : `${carrier.openTrips} viajes abiertos`}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {carrier.ratingAvg !== null ? (
                      <>
                        <RatingStars value={carrier.ratingAvg} size={14} />
                        <span>
                          {carrier.ratingAvg.toFixed(1)} ({carrier.ratingCount})
                        </span>
                      </>
                    ) : (
                      <span>sin calificaciones</span>
                    )}
                  </span>
                  {carrier.isAvailableNow && <Chip tone="ok">responde rápido ahora</Chip>}
                </div>

                <p className="mt-4 line-clamp-2 text-sm text-ink-soft">
                  {carrier.bio ?? "todavía no cargó su bio."}
                </p>

                <div className="mt-auto flex gap-2 pt-5">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link to={`/fleteros/${carrier.id}`}>Ver perfil</Link>
                  </Button>
                  {user?.role === "COMPANY" && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      disabled={createTripRequest.isPending}
                      onClick={() => handleRequestClick(carrier.id, carrier.name)}
                    >
                      {createTripRequest.isPending ? "enviando…" : "Solicitar viaje"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
