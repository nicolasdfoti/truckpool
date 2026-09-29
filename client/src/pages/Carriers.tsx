import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
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
    navigate(`/solicitudes?action=request&carrierId=${carrierId}&carrierName=${encodeURIComponent(carrierName)}`);
  }

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold">Transportistas</h1>
        <p className="mt-1 text-sm text-ink-soft">
          conocé a los fleteros que publican en TruckPool y llegá directo.
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
                registrate como transportista
              </Link>
            </Button>
          </div>
        )}

        {carriers && carriers.length > 0 && (
          <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {carriers.map((carrier) => (
              <li
                key={carrier.id}
                className="flex flex-col rounded-[10px] border border-line bg-white p-6 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas-line text-brand">
                    <Truck className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="flex-1">
                    <p className="font-display text-base font-medium">{carrier.name}</p>
                    <p className="text-[13px] text-ink-muted">
                      {carrier.openTrips === 1
                        ? "1 viaje abierto"
                        : `${carrier.openTrips} viajes abiertos`}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-muted">
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
                    </p>
                  </div>
                  {carrier.isAvailableNow && (
                    <span className="inline-flex items-center rounded-full bg-success-bg text-success-deep px-2 py-1 text-[11px] font-medium">
                      responde rápido ahora
                    </span>
                  )}
                </div>

                <p className="mt-4 line-clamp-2 text-[13px] text-ink-soft">
                  {carrier.bio ?? "todavía no cargó su bio."}
                </p>

                <div className="mt-5 flex gap-2">
                  <Button asChild variant="dark" size="sm" className="flex-1">
                    <Link to={`/fleteros/${carrier.id}`}>ver perfil</Link>
                  </Button>
                  {user?.role === "COMPANY" && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      disabled={createTripRequest.isPending}
                      onClick={() => handleRequestClick(carrier.id, carrier.name)}
                    >
                      {createTripRequest.isPending ? "enviando…" : "solicitar viaje"}
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
