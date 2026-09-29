import { useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { CargoFillDiagram } from "../components/CargoFillDiagram";
import { Button } from "../components/Button";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingBlock, SkeletonBar } from "../components/Loading";
import { TripFeatureBadge } from "../components/TripFeatureBadge";
import { TripStops } from "../components/TripStops";
import { useTrip } from "../hooks/useTrip";
import { useAuth } from "../hooks/useAuth";
import { useAddCargoItem } from "../hooks/useAddCargoItem";
import { useUpdateTripStatus } from "../hooks/useUpdateTripStatus";
import { useCancelCargoItem } from "../hooks/useCancelCargoItem";
import { useConfirmCargoItem } from "../hooks/useConfirmCargoItem";
import { useCreatePaymentPreference } from "../hooks/useCreatePaymentPreference";
import { useCreateReview } from "../hooks/useCreateReview";
import { useTripReviewStatus } from "../hooks/useTripReviewStatus";
import { useTripLocation } from "../hooks/useTripLocation";
import { RatingInput, RatingStars } from "../components/RatingInput";
import { MessageThread } from "../components/MessageThread";
import { LazyTripMap } from "../components/LazyTripMap";
import { useDownloadManifest } from "../hooks/useTripManifest";
import { usePlaceField } from "../hooks/usePlaceField";
import type { CargoItem, CargoItemStatus } from "../types/trip";
import { TRIP_STATUS_LABELS } from "../types/trip";
import { cancellationNote, fetchCancellationQuote } from "../lib/cancellation";
import type { CancellationQuote } from "../lib/cancellation";
import { formatTripDate } from "../lib/tripWhen";

const CARGO_STATUS_LABELS: Record<CargoItemStatus, string> = {
  PENDING: "pendiente",
  CONFIRMED: "confirmada",
  CANCELLED: "retirada",
};

const CARGO_STATUS_STYLES: Record<CargoItemStatus, string> = {
  PENDING: "bg-canvas-line text-ink-soft",
  CONFIRMED: "bg-success-bg text-success-deep",
  CANCELLED: "bg-canvas-line text-ink-soft line-through",
};

/**
 * Cuánto se lleva el transportista por una carga: la parte neta de la seña más
 * la del saldo. El reparto vive en cada Payment, no en el CargoItem, así que
 * se suma. `null` mientras no haya ningún pago con reparto asentado, para no
 * mostrar un $0 que parece un cobro real.
 */
function carrierNetOf(item: CargoItem): number | null {
  const nets = [item.depositPayment, item.balancePayment]
    .map((payment) => payment?.carrierAmount)
    .filter((value): value is number => typeof value === "number");
  if (nets.length === 0) return null;
  return nets.reduce((sum, value) => sum + value, 0);
}

function parseDecimalInput(raw: string): number {
  return Number(raw.trim().replace(",", "."));
}

function currency(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

/** el saldo también va a dos decimales, como lo calcula el backend */
function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Texto de confirmación del retiro. El monto sale del endpoint de quote del
 * servidor, nunca de una cuenta local: si no se pudo consultar, se confirma sin
 * prometer número en vez de estimarlo con una constante propia.
 */
function cancellationMessage(quote: CancellationQuote | null) {
  if (!quote) {
    return "?retirar esta carga? se libera el lugar. no pudimos calcular el monto a devolver, te lo confirmamos al retirar.";
  }
  if (quote.refundAmount > 0) {
    return `?retirar esta carga? se libera el lugar y te devolvemos ${currency(
      quote.refundAmount
    )} de la seña.`;
  }
  if (quote.feeAmount > 0) {
    return `?retirar esta carga? se libera el lugar, pero con menos de 24hs para la salida la seña de ${currency(
      quote.feeAmount
    )} no se devuelve.`;
  }
  return "?retirar esta carga? se libera el lugar y no se puede volver a sumar.";
}

/** Pide la quote y abre el confirm. Devuelve false si el usuario cancela. */
async function confirmCancellation(item: CargoItem, tripDate: string) {
  const quote = await fetchCancellationQuote(item.depositAmount, tripDate);
  return window.confirm(cancellationMessage(quote));
}

/** campo de dirección de pickup con el mismo picker de mapa que PublishTrip */
function PickupAddressField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const place = usePlaceField(value);

  return (
    <div>
      <label className="text-[13px] text-ink-soft" htmlFor="pickupAddress">
        dirección de retiro
      </label>
      <input
        id="pickupAddress"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ej: Av. Colón 1234, Córdoba"
        className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
      />
      {place.resolving && (
        <p className="mt-1 text-xs text-ink-muted">buscando la dirección…</p>
      )}
      {place.notFound && (
        <p className="mt-1 text-xs text-ink-muted">
          no encontramos esa dirección. podés publicarla igual, pero el pin no aparecerá
          en el mapa.
        </p>
      )}
      {place.movedByHand && (
        <p className="mt-1 text-xs text-ink-muted">pin corregido a mano</p>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export default function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: trip, isLoading, isError } = useTrip(id ?? "");
  const { user } = useAuth();
  const addCargoItem = useAddCargoItem(id ?? "");
  const updateStatus = useUpdateTripStatus(id ?? "");
  const downloadManifest = useDownloadManifest();
  const confirmCargoItem = useConfirmCargoItem(id ?? "");
  const cancelCargoItem = useCancelCargoItem(id ?? "");
  const createPaymentPreference = useCreatePaymentPreference(id ?? "");
  const createReview = useCreateReview(id ?? "");
  const reviewStatus = useTripReviewStatus(trip, user?.id);
  // el mapa solo aparece con el viaje en tránsito, y solo lo ven los que tienen
  // algo que ver con él (el fletero y las empresas con carga).
  const isInTransit = trip?.status === "IN_TRANSIT";
  const canSeeLocation =
    isInTransit &&
    Boolean(user) &&
    (user?.id === trip?.carrierId ||
      trip?.cargoItems.some((item) => item.companyId === user?.id));
  const { data: tripLocation } = useTripLocation(id ?? "", {
    enabled: canSeeLocation,
    isInTransit: Boolean(isInTransit),
  });

  const [description, setDescription] = useState("");
  const [volume, setVolume] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewTargetId, setReviewTargetId] = useState("");

  function handleSubmitReview(e: FormEvent) {
    e.preventDefault();
    if (rating === 0) {
      setReviewError("elegí cuántas estrellas le pones.");
      return;
    }
    setReviewError(null);
    createReview.mutate(
      {
        rating,
        comment: comment.trim() || undefined,
        toUserId: (reviewStatus.targetUserId ?? reviewTargetId) || undefined,
      },
      {
        onSuccess: () => {
          setRating(0);
          setComment("");
          setReviewTargetId("");
        },
      }
    );
  }

  if (isLoading) {
    return (
      <div className="bg-canvas font-sans">
        <LoadingBlock
          label="cargando viaje"
          className="mx-auto max-w-3xl space-y-5 px-6 py-20"
        >
          <SkeletonBar className="h-4 w-24" />
          <SkeletonBar className="h-8 w-3/4" />
          <SkeletonBar className="h-3.5 w-1/2" />
          <SkeletonBar className="h-40 w-full" />
        </LoadingBlock>
      </div>
    );
  }

  if (isError || !trip) {
    return (
      <div className="bg-canvas font-sans">
        <div className="mx-auto max-w-3xl px-6 py-20 text-sm text-danger">
          no pudimos cargar este viaje.
        </div>
      </div>
    );
  }

  const remaining = trip.capacityTotal - trip.capacityUsed;
  const isCarrierOwner = user?.role === "CARRIER" && user.id === trip.carrierId;
  const canAddCargo = user?.role === "COMPANY";
  // la mensajería del viaje solo existe para el transportista del viaje y las
  // empresas que tienen carga en él.
  const hasCargoInTrip = trip.cargoItems.some((item) => item.companyId === user?.id);
  const isParticipantInChat = Boolean(user) && (isCarrierOwner || hasCargoInTrip);
  // el remito tiene sentido recién cuando el viaje arrancó o terminó:
  // mientras está abierto o lleno las cargas pueden cambiar.
  const canDownloadManifest =
    isParticipantInChat && (trip.status === "IN_TRANSIT" || trip.status === "COMPLETED");
  const canConfirm = (companyId: string) =>
    (user?.role === "CARRIER" && user.id === trip.carrierId) ||
    (user?.role === "COMPANY" && user.id === companyId);
  // el backend solo deja retirar carga con el viaje abierto o lleno.
  const canCancelTrip = trip.status === "OPEN" || trip.status === "FULL";

  const nextAction: { status: "IN_TRANSIT" | "COMPLETED"; label: string } | null =
    trip.status === "OPEN" || trip.status === "FULL"
      ? { status: "IN_TRANSIT", label: "marcar en tránsito" }
      : trip.status === "IN_TRANSIT"
        ? { status: "COMPLETED", label: "marcar completado" }
        : null;

  function handleAddCargo(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsedVolume = parseDecimalInput(volume);

    if (!description.trim()) {
      setFormError("contanos qué querés mandar.");
      return;
    }
    if (!volume.trim() || Number.isNaN(parsedVolume) || parsedVolume <= 0) {
      setFormError("ingresá un volumen válido en m³ (ej: 1.5 o 1,5).");
      return;
    }
    if (!pickupAddress.trim()) {
      setFormError("la dirección de retiro es obligatoria.");
      return;
    }
    if (parsedVolume > remaining) {
      setFormError(`solo quedan ${remaining.toFixed(1)} m³ libres en este viaje.`);
      return;
    }

    addCargoItem.mutate(
      {
        description: description.trim(),
        volume: parsedVolume,
        pickupAddress: pickupAddress.trim(),
      },
      {
        onSuccess: () => {
          setDescription("");
          setVolume("");
          setPickupAddress("");
        },
        onError: (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "no se pudo sumar la carga.";
          setFormError(message);
        },
      }
    );
  }

  const actionError =
    updateStatus.error instanceof Error
      ? updateStatus.error.message
      : confirmCargoItem.error instanceof Error
        ? confirmCargoItem.error.message
        : createPaymentPreference.error instanceof Error
          ? createPaymentPreference.error.message
          : cancelCargoItem.error instanceof Error
            ? cancelCargoItem.error.message
            : null;

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link
          to="/viajes"
          className="text-sm font-medium text-brand hover:text-brand-hover"
        >
          ← volver a los viajes
        </Link>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              to={`/fleteros/${trip.carrierId}`}
              className="text-[13px] text-ink-muted hover:text-brand"
            >
              viaje de {trip.carrierName}
            </Link>
            <h1 className="mt-1 font-display text-[28px] font-medium">
              {trip.origin} → {trip.destination}
            </h1>
          </div>
          <StatusBadge status={trip.status} />
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-muted">
          <span>{formatTripDate(trip.date)}</span>
          {trip.departureTime && (
            <span className="font-medium text-ink-soft">sale {trip.departureTime}</span>
          )}
          <span>{trip.truckType}</span>
          <span>
            {trip.capacityUsed.toFixed(1)} / {trip.capacityTotal.toFixed(1)} m³ ocupados
          </span>
          <span className="font-medium text-brand">{currency(trip.price)}</span>
        </div>

        {trip.features.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {trip.features.map((feature) => (
              <TripFeatureBadge key={feature} feature={feature} />
            ))}
          </div>
        )}

        <div className="mt-8 rounded-[10px] border border-surface-line bg-surface p-6">
          <CargoFillDiagram
            capacityTotal={trip.capacityTotal}
            items={trip.cargoItems
              .filter((c) => c.status !== "CANCELLED")
              .map((c) => ({
                label: c.description,
                volume: c.volume,
              }))}
          />
        </div>

        {/* Paradas (pickups) del viaje */}
        <section className="mt-8" aria-labelledby="stops-heading">
          <h2 id="stops-heading" className="font-display text-[17px] font-medium">
            paradas de retiro
          </h2>
          <TripStops />
        </section>

        {canSeeLocation && (
          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-[17px] font-medium">
                ubicación del viaje
              </h2>
              {isCarrierOwner && (
                <Link
                  to={`/viajes/${trip.id}/trackear`}
                  className="text-[13px] text-brand underline"
                >
                  {tripLocation?.location
                    ? "actualizar mi ubicación"
                    : "compartir mi ubicación"}
                </Link>
              )}
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">
              se actualiza sola cada 15 segundos mientras el viaje está en tránsito.
            </p>
            <LazyTripMap
              location={tripLocation?.location ?? null}
              className="mt-3 h-72"
            />
            {tripLocation?.location && (
              <p className="mt-2 text-[13px] text-ink-muted">
                última posición:{" "}
                {new Date(tripLocation.location.recordedAt).toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </p>
            )}
          </section>
        )}

        {isCarrierOwner && nextAction && (
          <div className="mt-8 flex items-center justify-between gap-4 rounded-[10px] border border-line bg-white p-5">
            <div>
              <p className="font-display text-base font-medium">este es tu viaje</p>
              <p className="text-sm text-ink-soft">
                {nextAction.status === "IN_TRANSIT"
                  ? "marcalo como en viaje cuando salgas."
                  : "marcalo como completado cuando termines."}
              </p>
            </div>
            <Button
              variant="dark"
              size="md"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate(nextAction.status)}
            >
              {updateStatus.isPending ? "marcando…" : nextAction.label}
            </Button>
          </div>
        )}

        {canDownloadManifest && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-line bg-white p-5">
            <div>
              <p className="font-display text-base font-medium">manifiesto del viaje</p>
              <p className="text-sm text-ink-soft">
                descargá el remito en PDF con el detalle de las cargas.
              </p>
            </div>
            <Button
              variant="outline"
              size="md"
              disabled={downloadManifest.isPending}
              onClick={() => downloadManifest.mutate(trip.id)}
            >
              {downloadManifest.isPending ? "generando…" : "descargar remito"}
            </Button>
          </div>
        )}

        {downloadManifest.isError && (
          <p className="mt-2 text-sm text-ink-muted">{downloadManifest.error.message}</p>
        )}

        <section className="mt-8">
          <h2 className="font-display text-[17px] font-medium">cargas del viaje</h2>
          {trip.cargoItems.length === 0 && (
            <p className="mt-2 text-sm text-ink-muted">
              todavía no hay carga asignada a este viaje.
            </p>
          )}
          <ul className="mt-3 space-y-3">
            {trip.cargoItems.map((item) => {
              const deposit = item.depositPayment;
              const balance = item.balancePayment;
              const balanceAmount = round2(item.priceShare - item.depositAmount);
              const isCancelled = item.status === "CANCELLED";
              const isCompany = user?.id === item.companyId;
              const depositApproved = deposit?.status === "APPROVED";
              // el saldo solo existe con el viaje en camino y la carga
              // confirmada: antes de eso todavía no hay nada que cobrar.
              const balanceDue =
                item.status === "CONFIRMED" &&
                trip.status === "IN_TRANSIT" &&
                balanceAmount > 0;
              const showDepositPayButton =
                isCompany &&
                !isCancelled &&
                item.status === "PENDING" &&
                !depositApproved;
              const showBalancePayButton =
                isCompany && balanceDue && balance?.status !== "APPROVED";
              const showPayButton = showDepositPayButton || showBalancePayButton;
              // solo se puede retirar lo que sigue pendiente y con el viaje sin
              // arrancar: el botón vive al lado de las otras acciones.
              const showCancelButton =
                isCompany && item.status === "PENDING" && canCancelTrip;
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-4 rounded-[10px] border border-line bg-white p-4"
                >
                  <div className="flex items-center gap-3">
                    {depositApproved && (
                      <span className="inline-flex items-center rounded-full bg-brand px-3 py-1 text-xs font-medium text-white">
                        seña pagada
                      </span>
                    )}
                    {balance?.status === "APPROVED" && (
                      <span className="inline-flex items-center rounded-full bg-brand px-3 py-1 text-xs font-medium text-white">
                        saldo pagado
                      </span>
                    )}
                    {!showPayButton && (
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${CARGO_STATUS_STYLES[item.status]}`}
                      >
                        {CARGO_STATUS_LABELS[item.status]}
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-medium">{item.description}</p>
                      <p className="text-[13px] text-ink-muted">
                        {item.volume.toFixed(1)} m³ · {currency(item.priceShare)} del
                        viaje
                      </p>
                      {user?.role === "CARRIER" &&
                        user?.id === trip.carrierId &&
                        carrierNetOf(item) !== null && (
                          <p className="text-[12px] text-success-deep font-medium">
                            tu neto: {currency(carrierNetOf(item) ?? 0)} (comisión{" "}
                            {trip.platformFeePercent ?? 10}%)
                          </p>
                        )}
                      {item.pickupAddress && (
                        <p className="text-[12px] text-ink-muted font-mono">
                          retiro: {item.pickupAddress}
                        </p>
                      )}
                      {item.trackingCode && (
                        <p className="text-[12px] text-ink-muted font-mono">
                          código: {item.trackingCode}
                        </p>
                      )}
                      {showDepositPayButton && (
                        <p className="text-[13px] text-ink-muted">
                          seña de {currency(item.depositAmount)} para reservar el lugar ·
                          quedan {currency(balanceAmount)} al salir
                        </p>
                      )}
                      {balanceDue && balance?.status !== "APPROVED" && (
                        <p className="text-[13px] text-ink-muted">
                          saldo de {currency(balanceAmount)} pendiente
                        </p>
                      )}
                      {showDepositPayButton && deposit?.status === "REJECTED" && (
                        <p className="text-[13px] text-ink-muted">
                          el pago anterior fue rechazado, probá de nuevo.
                        </p>
                      )}
                      {isCancelled && (
                        <p className="text-[13px] text-ink-muted">
                          {cancellationNote(item)}
                        </p>
                      )}
                    </div>
                  </div>
                  {showPayButton || showCancelButton ? (
                    <div className="flex items-center gap-2">
                      {showCancelButton && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={cancelCargoItem.isPending}
                          onClick={async () => {
                            if (await confirmCancellation(item, trip.date)) {
                              cancelCargoItem.mutate(item.id);
                            }
                          }}
                        >
                          {cancelCargoItem.isPending ? "retirando…" : "retirar carga"}
                        </Button>
                      )}
                      {showPayButton && (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={createPaymentPreference.isPending}
                          onClick={() =>
                            createPaymentPreference.mutate({
                              cargoItemId: item.id,
                              type: showBalancePayButton ? "BALANCE" : "DEPOSIT",
                            })
                          }
                        >
                          {createPaymentPreference.isPending
                            ? "generando link…"
                            : showBalancePayButton
                              ? `pagar saldo ${currency(balanceAmount)}`
                              : `pagar seña ${currency(item.depositAmount)}`}
                        </Button>
                      )}
                    </div>
                  ) : (
                    item.status === "PENDING" &&
                    depositApproved &&
                    canConfirm(item.companyId) && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={confirmCargoItem.isPending}
                        onClick={() => confirmCargoItem.mutate(item.id)}
                      >
                        confirmar carga
                      </Button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {actionError && <p className="mt-4 text-[13px] text-danger">{actionError}</p>}

        {trip.status === "COMPLETED" && reviewStatus.participated && (
          <section className="mt-10 rounded-[10px] border border-line bg-white p-6">
            <h2 className="font-display text-[17px] font-medium">calificar el viaje</h2>

            {reviewStatus.reviewed ? (
              <p className="mt-2 text-[13px] text-ink-muted">
                ya calificaste a{" "}
                {reviewStatus.targetUserId === trip.carrierId
                  ? trip.carrierName
                  : (reviewStatus.companyOptions.find(
                      (company) => company.id === reviewStatus.targetUserId
                    )?.name ?? "tu contraparte")}
                . gracias por sumar datos para los demás.
              </p>
            ) : (
              <form onSubmit={handleSubmitReview} className="mt-4">
                <p className="text-[13px] text-ink-soft">
                  {reviewStatus.targetUserId === trip.carrierId
                    ? `¿cómo fue trabajar con ${trip.carrierName}?`
                    : "¿cómo fue el viaje con tu contraparte?"}
                </p>

                {reviewStatus.targetUserId === null &&
                  reviewStatus.companyOptions.length > 1 && (
                    <div className="mt-3">
                      <label className="text-[13px] text-ink-soft" htmlFor="reviewTarget">
                        ¿a cuál empresa querés calificar?
                      </label>
                      <select
                        id="reviewTarget"
                        value={reviewTargetId}
                        onChange={(e) => setReviewTargetId(e.target.value)}
                        className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
                      >
                        <option value="">elegí una empresa</option>
                        {reviewStatus.companyOptions.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                <div className="mt-4">
                  <RatingInput
                    value={rating}
                    onChange={setRating}
                    disabled={createReview.isPending}
                  />
                </div>

                <label
                  className="mt-4 block text-[13px] text-ink-soft"
                  htmlFor="reviewComment"
                >
                  comentario (opcional)
                </label>
                <textarea
                  id="reviewComment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="ej: puntual, avisó cuando hubo demora en la carga"
                  className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
                />
                <p className="mt-1 text-[13px] text-ink-muted">{comment.length}/500</p>

                {(reviewError || createReview.error) && (
                  <p className="mt-3 text-[13px] text-danger">
                    {reviewError ??
                      (createReview.error instanceof Error
                        ? createReview.error.message
                        : null)}
                  </p>
                )}

                <Button
                  type="submit"
                  size="md"
                  className="mt-4"
                  disabled={createReview.isPending}
                >
                  {createReview.isPending ? "enviando…" : "enviar calificación"}
                </Button>
              </form>
            )}
          </section>
        )}

        {isParticipantInChat && (
          <div className="mt-10">
            <MessageThread tripId={trip.id} currentUserId={user!.id} />
          </div>
        )}

        {trip.reviews.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-[17px] font-medium">calificaciones</h2>
            <ul className="mt-3 space-y-2">
              {trip.reviews.map((review) => (
                <li
                  key={review.id}
                  className="rounded-[10px] border border-line bg-white p-4"
                >
                  <div className="flex items-center gap-2">
                    <RatingStars value={review.rating} size={14} />
                    <span className="text-[13px] font-medium">{review.fromName}</span>
                    <span className="text-[13px] text-ink-muted">→ {review.toName}</span>
                  </div>
                  {review.comment && (
                    <p className="mt-1 text-[13px] text-ink-soft">{review.comment}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <form
          onSubmit={handleAddCargo}
          className="mt-10 rounded-[10px] border border-line bg-white p-6"
        >
          <h2 className="font-display text-[17px] font-medium">
            sumar carga a este viaje
          </h2>
          {trip.status !== "OPEN" && (
            <p className="mt-2 text-[13px] text-ink-muted">
              este viaje está {TRIP_STATUS_LABELS[trip.status]} y ya no admite cargas
              nuevas.
            </p>
          )}
          {trip.status === "OPEN" && !user && (
            <p className="mt-2 text-[13px] text-ink-muted">
              para sumar carga necesitás una cuenta de empresa:{" "}
              <Link
                to="/ingresar?tab=register&role=company"
                className="text-brand underline"
              >
                crear cuenta
              </Link>{" "}
              ·{" "}
              <Link to="/ingresar" className="text-brand underline">
                ingresar
              </Link>
            </p>
          )}
          {trip.status === "OPEN" && user && user.role !== "COMPANY" && (
            <p className="mt-2 text-[13px] text-ink-muted">
              para sumar carga necesitás una cuenta de empresa.{" "}
              <Link
                to="/ingresar?tab=register&role=company"
                className="text-brand underline"
              >
                crear cuenta de empresa
              </Link>
            </p>
          )}
          {canAddCargo && trip.status === "OPEN" && (
            <>
              <div className="mt-4 grid gap-4">
                <div>
                  <label className="text-[13px] text-ink-soft" htmlFor="description">
                    qué mandás
                  </label>
                  <input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="ej: heladera, 6 sillas, 10 cajas"
                    className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
                  />
                </div>
                <div>
                  <label className="text-[13px] text-ink-soft" htmlFor="volume">
                    volumen (m³)
                  </label>
                  <input
                    id="volume"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                    placeholder="ej: 1.5"
                    inputMode="decimal"
                    className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
                  />
                </div>
                <PickupAddressField
                  value={pickupAddress}
                  onChange={setPickupAddress}
                  error={formError ?? undefined}
                />
              </div>

              <Button
                type="submit"
                size="md"
                disabled={addCargoItem.isPending}
                className="mt-5"
              >
                {addCargoItem.isPending ? "sumando…" : "sumar carga"}
              </Button>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
