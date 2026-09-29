import { useParams, Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { TripCard } from "../components/TripCard";
import { RatingStars } from "../components/RatingInput";
import { Truck } from "../components/icons";
import { useCarrier } from "../hooks/useUserProfile";
import { useAuth } from "../hooks/useAuth";
import { useCreateTripRequest } from "../hooks/useTripRequests";
import { LoadingBlock, SkeletonBar } from "../components/Loading";

function formatReviewDate(value: string) {
  return new Date(value).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function CarrierProfile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const { data: profile, isLoading, isError } = useCarrier(id);
  const createTripRequest = useCreateTripRequest();

  // handler not used directly; navigation happens in the button onClick
  // keep for future use if needed

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link
          to="/fleteros"
          className="text-sm font-medium text-brand hover:text-brand-hover"
        >
          ← volver a los transportistas
        </Link>

        {isLoading && (
          <LoadingBlock label="cargando transportista" className="mt-8">
            <div className="flex items-start gap-4">
              <SkeletonBar className="h-14 w-14 rounded-full" />
              <div className="flex-1 space-y-3">
                <SkeletonBar className="h-5 w-1/2" />
                <SkeletonBar className="h-3.5 w-1/3" />
                <SkeletonBar className="h-3.5 w-2/3" />
              </div>
            </div>
          </LoadingBlock>
        )}

        {isError && (
          <p className="mt-10 rounded-md border border-line bg-white p-4 text-sm text-danger">
            no encontramos este transportista.
          </p>
        )}

        {profile && (
          <>
            <div className="mt-6 flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-canvas-line text-brand">
                <Truck className="h-7 w-7" aria-hidden />
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="font-display text-3xl font-semibold">{profile.name}</h1>
                  {profile.isAvailableNow && (
                    <span className="inline-flex items-center rounded-full bg-success-bg text-success-deep px-2 py-1 text-[11px] font-medium">
                      responde rápido ahora
                    </span>
                  )}
                </div>
                {profile.ratingAvg !== null ? (
                  <p className="mt-1 flex items-center gap-2 text-[13px] text-ink-muted">
                    <RatingStars value={profile.ratingAvg} />
                    <span>
                      {profile.ratingAvg.toFixed(1)} ·{" "}
                      {profile.ratingCount === 1
                        ? "1 calificación"
                        : `${profile.ratingCount} calificaciones`}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] text-ink-muted">
                    todavía no tiene calificaciones.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 rounded-[10px] border border-line bg-white p-6">
              <p className="text-sm text-ink-soft">
                {profile.bio ?? "todavía no cargó su bio."}
              </p>
              {profile.phone && (
                <p className="mt-3 text-[13px] text-ink-soft">
                  teléfono: <span className="font-medium text-ink">{profile.phone}</span>
                </p>
              )}
            </div>

            {user?.role === "COMPANY" && (
              <div className="mt-6">
                <Button
                  variant="primary"
                  size="md"
                  className="w-full"
                  disabled={createTripRequest.isPending}
                  onClick={() => navigate(`/solicitudes?action=request&carrierId=${profile.id}&carrierName=${encodeURIComponent(profile.name)}`)}
                >
                  {createTripRequest.isPending ? "enviando…" : "solicitar viaje"}
                </Button>
              </div>
            )}

            {profile.reviews.length > 0 && (
              <section className="mt-10">
                <h2 className="font-display text-[17px] font-medium">
                  qué dicen las empresas
                </h2>
                <ul className="mt-3 space-y-2">
                  {profile.reviews.map((review) => (
                    <li
                      key={review.id}
                      className="rounded-[10px] border border-line bg-white p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <RatingStars value={review.rating} size={14} />
                        <span className="text-[13px] font-medium">{review.fromName}</span>
                        <span className="text-[13px] text-ink-muted">
                          · {review.trip.origin} → {review.trip.destination} ·{" "}
                          {formatReviewDate(review.createdAt)}
                        </span>
                      </div>
                      {review.comment && (
                        <p className="mt-1 text-[13px] text-ink-soft">{review.comment}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-10">
              <h2 className="font-display text-[17px] font-medium">viajes abiertos</h2>
              {profile.trips.length === 0 && (
                <p className="mt-2 text-sm text-ink-muted">
                  por ahora no tiene viajes abiertos.
                </p>
              )}
              {profile.trips.length > 0 && (
                <ul className="mt-3 grid gap-4">
                  {profile.trips.map((trip) => (
                    <TripCard key={trip.id} trip={trip} showCarrier={false} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
