import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { CargoFillDiagram } from "../components/CargoFillDiagram";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingBlock, SkeletonBar } from "../components/Loading";
import { TripFeatureBadge } from "../components/TripFeatureBadge";
import { TripStops } from "../components/TripStops";
import { useTrip } from "../hooks/useTrip";
import { useAuth } from "../hooks/useAuth";
import { useAddCargoItem } from "../hooks/useAddCargoItem";
import { useLoginHref } from "../hooks/useLoginHref";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useUpdateTripStatus } from "../hooks/useUpdateTripStatus";
import { useCancelCargoItem } from "../hooks/useCancelCargoItem";
import { useConfirmCargoItem } from "../hooks/useConfirmCargoItem";
import { useCreatePaymentPreference } from "../hooks/useCreatePaymentPreference";
import { useCargoQuote } from "../hooks/useCargoQuote";
import { useCreateReview } from "../hooks/useCreateReview";
import { useTripReviewStatus } from "../hooks/useTripReviewStatus";
import { useTripLocation } from "../hooks/useTripLocation";
import { RatingInput, RatingStars } from "../components/RatingInput";
import { MessageThread } from "../components/MessageThread";
import { LazyTripMap } from "../components/LazyTripMap";
import { LazyTripRouteMap } from "../components/LazyTripRouteMap";
import { useTripRoute, useTripRouteGeometry } from "../hooks/useTripRoute";
import { useDownloadManifest } from "../hooks/useTripManifest";
import { usePlaceField } from "../hooks/usePlaceField";
import { ApiError } from "../api/client";
import type {
  CargoItem,
  CargoItemStatus,
  TripDetail as TripDetailData,
  TripStatus,
} from "../types/trip";
import { Chip, type ChipTone } from "../components/Chip";
import { MoneyTimeline, type MoneyStep } from "../components/MoneyTimeline";
import { formatM3, formatPesos, formatTripDay, pricePerM3 } from "../lib/format";
import { TRIP_STATUS_LABELS } from "../types/trip";
import { cancellationNote, cancelledLabel } from "../lib/cancellation";
import { WithdrawCargoDialog } from "../components/WithdrawCargoDialog";
import { DepartTripDialog } from "../components/DepartTripDialog";
import { CancelTripDialog } from "../components/CancelTripDialog";
import { departureSummary } from "../lib/departure";
import { formatInstant } from "../lib/tripWhen";

const CARGO_STATUS_LABELS: Record<CargoItemStatus, string> = {
  PENDING: "pendiente",
  CONFIRMED: "confirmada",
  // la de CANCELLED depende del motivo: ver cancelledLabel
  CANCELLED: "cancelada",
};

const CARGO_STATUS_TONES: Record<CargoItemStatus, ChipTone> = {
  PENDING: "neutral",
  CONFIRMED: "ok",
  CANCELLED: "neutral",
};

const STAGES: { status: TripStatus; label: string }[] = [
  { status: "OPEN", label: "Abierto" },
  { status: "FULL", label: "Lleno" },
  { status: "IN_TRANSIT", label: "En camino" },
  { status: "COMPLETED", label: "Completado" },
];

/** la barra del estado del viaje en 4 tramos; un viaje cancelado no la lleva */
function TripStageBar({ status }: { status: TripStatus }) {
  const current = STAGES.findIndex((s) => s.status === status);
  if (current === -1) return null;
  return (
    <ol aria-label="etapas del viaje" className="mt-6 grid max-w-2xl grid-cols-4 gap-1">
      {STAGES.map((stage, i) => (
        <li
          key={stage.status}
          aria-current={i === current ? "step" : undefined}
          className={`border-t-4 pt-2 text-xs sm:text-[13px] ${
            i <= current ? "border-brand" : "border-line"
          } ${i === current ? "font-medium text-ink" : "text-ink-soft"}`}
        >
          {stage.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * La línea de tiempo del dinero de una carga propia: reserva → seña →
 * confirmación → salida → saldo. Sale de los mismos estados que la fila (no
 * calcula montos: los trae el server).
 */
function moneySteps(
  item: CargoItem,
  trip: TripDetailData,
  balanceDue: boolean
): MoneyStep[] {
  const depositPaid = item.depositPayment?.status === "APPROVED";
  const balancePaid = item.balancePayment?.status === "APPROVED";
  const confirmed = item.status === "CONFIRMED";
  const departed = trip.status === "IN_TRANSIT" || trip.status === "COMPLETED";
  return [
    { what: "Reserva", state: "done", when: formatInstant(item.createdAt) },
    {
      what: "Seña",
      state: depositPaid ? "done" : "now",
      amount: currency(item.depositAmount),
      when: depositPaid ? "pagada" : undefined,
    },
    {
      what: "Confirmación",
      state: confirmed ? "done" : depositPaid ? "now" : "later",
      when: confirmed ? undefined : "la hace el fletero",
    },
    {
      what: "Salida",
      state: departed ? "done" : "later",
      when: `${formatTripDay(trip.date)}${trip.departureTime ? `, ${trip.departureTime}` : ""}`,
    },
    {
      what: "Saldo",
      state: balancePaid ? "done" : balanceDue ? "now" : "later",
      amount: currency(item.balanceAmount),
      when: balancePaid ? "pagado" : "cuando sale el viaje",
    },
  ];
}

/**
 * Cuánto se lleva el transportista por una carga: la parte neta de la seña más
 * la del saldo, después de lo devuelto (una seña devuelta a medias deja la
 * mitad). El reparto vive en cada Payment, no en el CargoItem, así que se suma.
 * `null` mientras no haya ningún pago con reparto asentado, para no mostrar un
 * $0 que parece un cobro real.
 */
function carrierNetOf(item: CargoItem): number | null {
  const nets = [item.depositPayment, item.balancePayment]
    .map((payment) => payment?.netCarrierAmount)
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

/** el volumen escrito, si es un número válido para cotizar; si no, null */
function quotableVolume(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = parseDecimalInput(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** faltando menos de esto, «reservado hasta» se pone en rojo (03§1.2) */
const RESERVATION_URGENT_MS = 3 * 60 * 60 * 1000;

/** RD3 / QW13: botones de la fila de una carga; en mobile a lo ancho y de 44 px */
const ROW_ACTION = "min-h-11 w-full whitespace-nowrap sm:min-h-0 sm:w-auto";
/** en la columna del costado la fila va siempre apilada, con botones a lo ancho */
const STACKED_ACTION = "min-h-11 w-full";

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
      <label className="field-label" htmlFor="pickupAddress">
        Dirección de retiro
      </label>
      <input
        id="pickupAddress"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ej: Av. Colón 1234, Córdoba"
        className="input mt-1.5"
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
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export default function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const {
    data: trip,
    isLoading,
    isError,
    error: tripError,
    refetch: refetchTrip,
  } = useTrip(id ?? "");
  const tripNotFound = tripError instanceof ApiError && tripError.status === 404;
  // QW8: la pestaña dice qué viaje es
  useDocumentTitle(
    trip
      ? `${trip.origin} → ${trip.destination} — TruckPool`
      : tripNotFound
        ? "Viaje no encontrado — TruckPool"
        : null
  );
  const { user } = useAuth();
  const addCargoItem = useAddCargoItem(id ?? "");
  const updateStatus = useUpdateTripStatus(id ?? "");
  const downloadManifest = useDownloadManifest();
  const confirmCargoItem = useConfirmCargoItem(id ?? "");
  const cancelCargoItem = useCancelCargoItem(id ?? "");
  const createPaymentPreference = useCreatePaymentPreference(id ?? "");
  const createReview = useCreateReview(id ?? "");
  const reviewStatus = useTripReviewStatus(trip, user);
  // RD8: ingresar o crear cuenta desde el viaje vuelve al viaje
  const loginLink = useLoginHref();
  // U7/U8: recorrido, paradas, ubicación y remito son del fletero dueño y de
  // las empresas con carga viva. Al resto (también el ex participante, D9) el
  // server le responde 401/403, así que ni se piden.
  const isActiveViewer =
    trip?.viewerAccess === "CARRIER_OWNER" || trip?.viewerAccess === "PARTICIPANT";
  // el mapa de ubicación solo aparece con el viaje en tránsito
  const isInTransit = trip?.status === "IN_TRANSIT";
  const canSeeLocation = isInTransit && isActiveViewer;
  const { data: tripLocation } = useTripLocation(id ?? "", {
    enabled: canSeeLocation,
    isInTransit: Boolean(isInTransit),
  });
  // El recorrido (partida → paradas → destino) no depende de que el viaje esté
  // en tránsito: se ve desde que la empresa reserva, que es justo cuando quiere
  // ver dónde pasa a buscar su carga.
  const { data: tripRoute } = useTripRoute(id ?? "", isActiveViewer);
  // La geometría real es un extra: si OSRM no responde, la query queda vacía y
  // el mapa del recorrido dibuja las rectas entre los puntos, sin avisar.
  const { data: tripRouteGeometry } = useTripRouteGeometry(id ?? "", isActiveViewer);

  const [description, setDescription] = useState("");
  const [volume, setVolume] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [stopDistanceError, setStopDistanceError] = useState<string | null>(null);
  const [tripStartedError, setTripStartedError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  // la carga que la empresa está por retirar (diálogo con el desglose, U21)
  const [withdrawItemId, setWithdrawItemId] = useState<string | null>(null);
  // «¿salís ahora?» (D3)
  const [departOpen, setDepartOpen] = useState(false);
  // «¿cancelar el viaje?» (D6)
  const [cancelTripOpen, setCancelTripOpen] = useState(false);
  // 03§1.3: precio, seña y saldo antes de reservar, del server
  const cargoQuote = useCargoQuote(id ?? "", quotableVolume(volume));
  // la hora para el aviso de la reserva por vencer; se refresca cada minuto
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // RD7: la carga recién reservada. Cuando llega con el viaje, se la lleva a la
  // vista (el formulario queda abajo de todo y «pagar seña» arriba) una sola
  // vez: los refetch del viaje no vuelven a mover la página.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const scrolledToRef = useRef<string | null>(null);
  const justAddedArrived =
    justAddedId !== null && (trip?.cargoItems.some((c) => c.id === justAddedId) ?? false);
  useEffect(() => {
    if (!justAddedArrived || scrolledToRef.current === justAddedId) return;
    const row = document.getElementById(`carga-${justAddedId}`);
    if (!row) return;
    scrolledToRef.current = justAddedId;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [justAddedArrived, justAddedId]);

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
      },
      {
        onSuccess: () => {
          setRating(0);
          setComment("");
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

  // RD10 / QW8: un 404 no es un error de carga; los dos con salida
  if (isError || !trip) {
    return (
      <div className="bg-canvas font-sans text-ink">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h1 className="font-display text-2xl font-semibold">
            {tripNotFound
              ? "este viaje no existe o ya no está publicado"
              : "no pudimos cargar este viaje"}
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {tripNotFound
              ? "puede que el link esté incompleto o que el viaje se haya dado de baja."
              : "puede ser un problema de conexión. probá de nuevo en un rato."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {!tripNotFound && (
              <Button variant="primary" size="md" onClick={() => refetchTrip()}>
                Reintentar
              </Button>
            )}
            <Button asChild variant={tripNotFound ? "primary" : "outline"} size="md">
              <Link to="/viajes">ver viajes disponibles</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const remaining = trip.capacityTotal - trip.capacityUsed;
  const isCarrierOwner = user?.role === "CARRIER" && user.id === trip.carrierId;
  // U7: el fletero y la empresa ven la descripción de lo que pueden ver
  // completo; las cargas ajenas son "otra carga", y a terceros solo les llega
  // el total ocupado, sin nombres.
  const seesCargoList = trip.viewerAccess !== "ANONYMOUS";
  const visibleCargo = trip.cargoItems.filter((c) => c.status !== "CANCELLED");
  const occupancyItems =
    trip.viewerAccess === "CARRIER_OWNER" || trip.viewerAccess === "PARTICIPANT"
      ? [
          ...visibleCargo.map((c) => ({
            label: c.description,
            volume: c.volume,
            own: true,
          })),
          ...trip.otherCargo.map((c) => ({ label: "otra carga", volume: c.volume })),
        ]
      : trip.capacityUsed > 0
        ? [{ volume: trip.capacityUsed }]
        : [];
  const canAddCargo = user?.role === "COMPANY";
  // con carga propia en el viaje, el naranja es pagar: sumar otra va en navy
  const hasOwnActiveCargo = trip.cargoItems.some(
    (c) => c.companyId === user?.id && c.status !== "CANCELLED"
  );
  // la mensajería del viaje es del fletero y de las empresas con carga en él,
  // también las que retiraron la suya: conservan su conversación con el
  // fletero para hablar del reembolso (D9). Ubicación, paradas y mapa no.
  const isParticipantInChat = Boolean(user) && trip.viewerAccess !== "ANONYMOUS";
  // el remito tiene sentido recién cuando el viaje arrancó o terminó:
  // mientras está abierto o lleno las cargas pueden cambiar.
  const canDownloadManifest =
    isActiveViewer && (trip.status === "IN_TRANSIT" || trip.status === "COMPLETED");
  // D1 = a: confirmar es el compromiso de llevar la carga, solo del fletero
  // (el server le responde 403 a la empresa)
  const canConfirm = isCarrierOwner;
  const departure = departureSummary(trip.cargoItems);
  // el backend solo deja retirar carga con el viaje abierto o lleno.
  const canCancelTrip = trip.status === "OPEN" || trip.status === "FULL";

  const nextAction: { status: "IN_TRANSIT" | "COMPLETED"; label: string } | null =
    trip.status === "OPEN" || trip.status === "FULL"
      ? { status: "IN_TRANSIT", label: "Marcar en tránsito" }
      : trip.status === "IN_TRANSIT"
        ? { status: "COMPLETED", label: "Marcar completado" }
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
        onSuccess: (created) => {
          setJustAddedId(created.id);
          setDescription("");
          setVolume("");
          setPickupAddress("");
          setStopDistanceError(null);
          setTripStartedError(null);
        },
        onError: (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "no se pudo sumar la carga.";
          // Dos rechazos del backend llegan con code y se explican mejor en un
          // modal que en el error del formulario: la parada fuera del trayecto y
          // el viaje que ya llegó a su fecha (TRIP_DATE_PASSED).
          if (err instanceof ApiError) {
            if (err.code === "STOP_TOO_FAR_FROM_ROUTE") {
              setStopDistanceError(err.message);
              setFormError(null);
              return;
            }
            if (err.code === "TRIP_DATE_PASSED") {
              setTripStartedError(err.message);
              setFormError(null);
              return;
            }
          }
          setFormError(message);
        },
      }
    );
  }

  // el error de salir y el de cancelar el viaje se ven dentro de su diálogo
  const actionError =
    updateStatus.error instanceof Error && updateStatus.variables === "COMPLETED"
      ? updateStatus.error.message
      : confirmCargoItem.error instanceof Error
        ? confirmCargoItem.error.message
        : null;

  // 03/Pagar seña#2: el error del pago va en la fila de la carga que se quiso
  // pagar, no abajo de todo
  const paymentErrorFor = (cargoItemId: string) =>
    createPaymentPreference.error instanceof Error &&
    createPaymentPreference.variables?.cargoItemId === cargoItemId
      ? createPaymentPreference.error
      : null;

  return (
    <div className="bg-canvas font-sans text-ink">
      <div className="border-b border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Link
            to="/viajes"
            className="text-sm font-medium text-brand hover:text-brand-hover"
          >
            ← Volver a los viajes
          </Link>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <h1 className="font-display text-[clamp(28px,3.6vw,40px)] leading-tight font-semibold">
              {trip.origin} → {trip.destination}
            </h1>
            <StatusBadge status={trip.status} />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap">
            <div>
              <dt className="text-sm text-ink-soft">Salida</dt>
              <dd className="font-medium">
                {formatTripDay(trip.date)}
                {trip.departureTime && `, sale ${trip.departureTime}`}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Camión</dt>
              <dd className="font-medium">
                {trip.truckType} de {formatM3(trip.capacityTotal)} m³
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Precio</dt>
              <dd className="font-medium">
                {formatPesos(pricePerM3(trip))} por m³{" "}
                <span className="font-normal text-ink-soft">
                  ({currency(trip.price)} el camión)
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-soft">Fletero</dt>
              <dd className="font-medium">
                <Link
                  to={`/fleteros/${trip.carrierId}`}
                  className="text-brand underline hover:text-brand-hover"
                >
                  {trip.carrierName}
                </Link>
              </dd>
            </div>
          </dl>

          {trip.features.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {trip.features.map((feature) => (
                <TripFeatureBadge key={feature} feature={feature} />
              ))}
            </div>
          )}

          <TripStageBar status={trip.status} />
        </div>
      </div>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10 lg:py-10">
        <div className="min-w-0">
          <section
            aria-labelledby="space-heading"
            className="rounded-xl border border-line bg-white p-5 sm:p-6"
          >
            <h2 id="space-heading" className="font-display text-xl font-semibold">
              Lugar en el camión
            </h2>
            <CargoFillDiagram
              className="mt-5"
              capacityTotal={trip.capacityTotal}
              cargoCount={trip.cargoCount}
              items={occupancyItems}
            />
          </section>

          {/* Paradas (pickups): solo el fletero y las empresas con carga viva (U19).
            Al resto el endpoint le da 403, así que ni se pide. */}
          {isActiveViewer && (
            <section className="mt-8" aria-labelledby="stops-heading">
              <h2 id="stops-heading" className="font-display text-xl font-semibold">
                Paradas de retiro
              </h2>
              <TripStops
                tripId={trip.id}
                canReorder={trip.viewerAccess === "CARRIER_OWNER"}
              />
            </section>
          )}

          {/* Recorrido completo: salida, paradas en orden y llegada. */}
          <section className="mt-8" aria-labelledby="route-heading">
            <h2 id="route-heading" className="font-display text-xl font-semibold">
              Recorrido del viaje
            </h2>
            {!isActiveViewer ? (
              // sin mapa: el detalle no trae coordenadas y /route es solo para
              // participantes (el mapa de origen y destino queda para L10)
              <p className="mt-1 text-[13px] text-ink-muted">
                sale de {trip.origin} y llega a {trip.destination}. el mapa con las
                paradas lo ven el fletero y las empresas con carga en el viaje.
              </p>
            ) : tripRoute ? (
              <>
                <p className="mt-1 text-[13px] text-ink-muted">
                  los números son el orden en el que se pasan los puntos.
                </p>
                <LazyTripRouteMap
                  className="mt-3 h-80"
                  route={tripRoute}
                  geometry={tripRouteGeometry?.geometry}
                />
                {tripRoute.departureIsExact && (
                  <p className="mt-2 text-[13px] text-ink-muted">
                    sale desde {trip.departureAddress}, y desde ahí se ordena el resto del
                    recorrido.
                  </p>
                )}
                {/* Un punto fuera es un geocode caído. Vale la pena decirlo, pero
                  sin tapar ni attenuar el resto del recorrido. */}
                {tripRoute.incomplete && (
                  <p className="mt-2 text-[13px] text-ink-muted">
                    hay paradas sin ubicación confirmada, así que el recorrido puede no
                    reflejar el orden real.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-[13px] text-ink-muted">
                  los números son el orden en el que se pasan los puntos.
                </p>
                <div className="mt-3 h-80 animate-pulse rounded-xl border border-line bg-canvas" />
              </>
            )}
          </section>

          {canSeeLocation && (
            <section className="mt-8">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-display text-xl font-semibold">
                  Ubicación del viaje
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
                  {new Date(tripLocation.location.recordedAt).toLocaleTimeString(
                    "es-AR",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    }
                  )}
                </p>
              )}
            </section>
          )}

          {isCarrierOwner && (
            <>
              {seesCargoList && (
                <section className={isCarrierOwner ? "mt-10" : ""}>
                  <h2 className="font-display text-xl font-semibold">
                    {isCarrierOwner
                      ? "Cargas del viaje"
                      : trip.cargoItems.length > 1
                        ? "Tus cargas"
                        : "Tu carga"}
                  </h2>
                  {/* 03§1.4: el checklist de salida, para el fletero mientras no salió */}
                  {isCarrierOwner && canCancelTrip && trip.cargoItems.length > 0 && (
                    <p className="mt-2 rounded-md border border-surface-line bg-surface px-3 py-2 text-[13px] text-ink-soft">
                      <span className="font-medium text-ink">antes de salir:</span>{" "}
                      confirmá las cargas con seña pagada ({departure.confirmed.length} de{" "}
                      {departure.withDeposit}). las cargas sin confirmar se cancelan
                      cuando marcás el viaje en tránsito, y a cada empresa le devolvemos
                      la seña que haya pagado.
                    </p>
                  )}
                  {trip.cargoItems.length === 0 && (
                    <p className="mt-2 text-sm text-ink-muted">
                      todavía no hay carga asignada a este viaje.
                    </p>
                  )}
                  <ul className="mt-3 space-y-3" aria-label="cargas del viaje">
                    {trip.cargoItems.map((item) => {
                      const deposit = item.depositPayment;
                      const balance = item.balancePayment;
                      // del server (L7): el client no resta montos
                      const balanceAmount = item.balanceAmount;
                      const isCancelled = item.status === "CANCELLED";
                      const isCompany = user?.id === item.companyId;
                      const depositApproved = deposit?.status === "APPROVED";
                      // un contracargo no se vuelve a pagar: lo resuelve un admin
                      const chargedBack =
                        deposit?.status === "CHARGED_BACK" ||
                        balance?.status === "CHARGED_BACK";
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
                        !depositApproved &&
                        !chargedBack;
                      const showBalancePayButton =
                        isCompany &&
                        balanceDue &&
                        balance?.status !== "APPROVED" &&
                        balance?.status !== "CHARGED_BACK";
                      const showPayButton = showDepositPayButton || showBalancePayButton;
                      const paymentError = paymentErrorFor(item.id);
                      // el fletero desconectó Mercado Pago: reintentar no sirve, así
                      // que el botón queda deshabilitado con el motivo
                      const cannotCharge =
                        paymentError instanceof ApiError &&
                        paymentError.code === "MP_ACCOUNT_NOT_CONNECTED";
                      // se retira lo pendiente o confirmado (hasta la salida, con la misma
                      // penalidad) mientras el viaje no arrancó: el botón vive al lado
                      // de las otras acciones.
                      const showCancelButton =
                        isCompany &&
                        (item.status === "PENDING" || item.status === "CONFIRMED") &&
                        canCancelTrip;
                      return (
                        // RD3 / QW13: en mobile la fila se apila (estado, datos y
                        // botones a lo ancho); en desktop vuelve a ser una línea
                        <li
                          key={item.id}
                          id={`carga-${item.id}`}
                          className={`flex flex-col gap-3 rounded-xl border bg-white p-4 ${
                            !isCarrierOwner
                              ? ""
                              : "sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                          } ${
                            item.id === justAddedId
                              ? "border-success ring-2 ring-success-bg"
                              : "border-line"
                          }`}
                        >
                          <div
                            className={`flex min-w-0 flex-col gap-2 ${
                              !isCarrierOwner
                                ? ""
                                : "sm:flex-row sm:items-center sm:gap-3"
                            }`}
                          >
                            <div
                              className={`flex flex-wrap items-center gap-2 ${!isCarrierOwner ? "" : "sm:contents"}`}
                            >
                              {depositApproved && <Chip tone="ok">seña pagada</Chip>}
                              {balance?.status === "APPROVED" && (
                                <Chip tone="ok">saldo pagado</Chip>
                              )}
                              {!showPayButton && (
                                <Chip tone={CARGO_STATUS_TONES[item.status]}>
                                  {item.status === "CANCELLED"
                                    ? cancelledLabel(item.cancellationReason)
                                    : CARGO_STATUS_LABELS[item.status]}
                                </Chip>
                              )}
                            </div>
                            <div className="min-w-0">
                              {/* RD7: el aviso de la reserva, en la fila donde se paga */}
                              {item.id === justAddedId && (
                                <p
                                  role="status"
                                  className="mb-1 text-[13px] font-medium text-success-deep"
                                >
                                  {showDepositPayButton
                                    ? "listo, reservaste tu lugar. pagá la seña para confirmarlo."
                                    : "listo, reservaste tu lugar."}
                                </p>
                              )}
                              <p className="font-semibold text-ink">{item.description}</p>
                              <p className="text-[13px] text-ink-muted">
                                {item.volume.toFixed(1)} m³ · {currency(item.priceShare)}{" "}
                                del viaje
                              </p>
                              {user?.role === "CARRIER" &&
                                user?.id === trip.carrierId &&
                                carrierNetOf(item) !== null && (
                                  <p className="text-[12px] text-success-deep font-medium">
                                    tu neto: {currency(carrierNetOf(item) ?? 0)} (comisión{" "}
                                    {trip.platformFeePercent}%)
                                  </p>
                                )}
                              {item.pickupAddress && (
                                <p className="text-[12px] text-ink-muted font-mono break-words">
                                  retiro: {item.pickupAddress}
                                </p>
                              )}
                              {item.trackingCode && (
                                <p className="text-[12px] text-ink-muted font-mono break-all">
                                  código: {item.trackingCode}
                                </p>
                              )}
                              {showDepositPayButton && (
                                <p className="text-[13px] text-ink-muted">
                                  seña de {currency(item.depositAmount)} para reservar el
                                  lugar · quedan {currency(balanceAmount)} al salir
                                </p>
                              )}
                              {/* 03§1.2 / QW12: hasta cuándo vale la reserva sin seña */}
                              {showDepositPayButton && item.reservationExpiresAt && (
                                <p
                                  className={`text-[13px] ${
                                    new Date(item.reservationExpiresAt).getTime() - now <
                                    RESERVATION_URGENT_MS
                                      ? "font-medium text-danger"
                                      : "text-ink-muted"
                                  }`}
                                >
                                  reservado hasta el{" "}
                                  {formatInstant(item.reservationExpiresAt)}. si no pagás
                                  la seña antes, el lugar se libera.
                                </p>
                              )}
                              {/* 03§1.3: con la seña paga, el saldo no se pierde de vista */}
                              {isCompany &&
                                depositApproved &&
                                !isCancelled &&
                                (trip.status === "OPEN" || trip.status === "FULL") &&
                                balanceAmount > 0 && (
                                  <p className="text-[13px] text-ink-muted">
                                    el saldo de {currency(balanceAmount)} se paga cuando
                                    el viaje sale.
                                  </p>
                                )}
                              {balanceDue &&
                                balance?.status !== "APPROVED" &&
                                balance?.status !== "CHARGED_BACK" && (
                                  <p className="text-[13px] text-ink-muted">
                                    saldo de {currency(balanceAmount)} pendiente
                                  </p>
                                )}
                              {chargedBack && (
                                <p className="text-[13px] text-ink-muted">
                                  el pago tiene un contracargo en Mercado Pago: lo revisa
                                  un admin.
                                </p>
                              )}
                              {/* D1: el fletero sabe por qué todavía no puede confirmar */}
                              {isCarrierOwner &&
                                item.status === "PENDING" &&
                                !depositApproved &&
                                !chargedBack && (
                                  <p className="text-[13px] text-ink-muted">
                                    {item.reservationExpiresAt
                                      ? `esperando la seña de la empresa (vence ${formatInstant(item.reservationExpiresAt)})`
                                      : "esperando que se acredite la seña de la empresa"}
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
                              {isCompany && !isCancelled && (
                                <MoneyTimeline
                                  className="mt-4 mb-1"
                                  steps={moneySteps(item, trip, balanceDue)}
                                />
                              )}
                              {showPayButton && paymentError && (
                                <p role="alert" className="mt-1 text-[13px] text-danger">
                                  {cannotCharge
                                    ? `este viaje no puede recibir pagos por ahora.${
                                        item.reservationExpiresAt
                                          ? ` tu lugar queda reservado hasta el ${formatInstant(item.reservationExpiresAt)}.`
                                          : ""
                                      }`
                                    : paymentError.message}
                                </p>
                              )}
                            </div>
                          </div>
                          {showPayButton || showCancelButton ? (
                            <div
                              className={`flex flex-col gap-2 ${
                                !isCarrierOwner
                                  ? ""
                                  : "sm:shrink-0 sm:flex-row sm:items-center"
                              }`}
                            >
                              {showCancelButton && (
                                <Button
                                  variant="outline-danger"
                                  size="sm"
                                  className={
                                    !isCarrierOwner ? STACKED_ACTION : ROW_ACTION
                                  }
                                  disabled={cancelCargoItem.isPending}
                                  onClick={() => {
                                    cancelCargoItem.reset();
                                    setWithdrawItemId(item.id);
                                  }}
                                >
                                  Retirar carga
                                </Button>
                              )}
                              {showPayButton && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  className={
                                    !isCarrierOwner ? STACKED_ACTION : ROW_ACTION
                                  }
                                  disabled={
                                    createPaymentPreference.isPending || cannotCharge
                                  }
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
                                      ? `Pagar saldo ${currency(balanceAmount)}`
                                      : `Pagar seña ${currency(item.depositAmount)}`}
                                </Button>
                              )}
                            </div>
                          ) : (
                            item.status === "PENDING" &&
                            depositApproved &&
                            canConfirm && (
                              <Button
                                variant="primary"
                                size="sm"
                                className={!isCarrierOwner ? STACKED_ACTION : ROW_ACTION}
                                disabled={confirmCargoItem.isPending}
                                onClick={() => confirmCargoItem.mutate(item.id)}
                              >
                                Confirmar carga
                              </Button>
                            )
                          )}
                        </li>
                      );
                    })}
                    {/* las cargas de otras empresas: el volumen y la localidad del
                  retiro, nunca la dirección (U7, L6) */}
                    {trip.otherCargo.map((other, i) => (
                      <li
                        key={`otra-${i}`}
                        className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 text-sm text-ink-soft"
                      >
                        <span
                          aria-hidden="true"
                          className="size-4 shrink-0 rounded-[3px] bg-hatch"
                        />
                        otra carga ·{" "}
                        {other.volume.toLocaleString("es-AR", {
                          maximumFractionDigits: 1,
                        })}{" "}
                        m³
                        {other.pickupCity && ` · retiro en ${other.pickupCity}`}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {actionError && (
                <p className="mt-4 text-[13px] text-danger">{actionError}</p>
              )}
            </>
          )}

          {/* Solo califican las empresas con carga en el viaje. El fletero no
            califica: el backend lo rechaza con 403 igual que la UI lo oculta. */}
          {(reviewStatus.reviewed || reviewStatus.canReview) && (
            <section className="mt-10 rounded-xl border border-line bg-white p-5 sm:p-6">
              <h2 className="font-display text-xl font-semibold">Calificar el viaje</h2>

              {reviewStatus.reviewed ? (
                <p className="mt-2 text-[13px] text-ink-muted">
                  ya calificaste a {trip.carrierName}. gracias por sumar datos para los
                  demás.
                </p>
              ) : (
                <form onSubmit={handleSubmitReview} className="mt-4">
                  <p className="text-[13px] text-ink-soft">
                    ¿cómo fue trabajar con {trip.carrierName}?
                  </p>

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
                    className="input mt-1.5"
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
              <h2 className="font-display text-xl font-semibold">Calificaciones</h2>
              <ul className="mt-3 space-y-2">
                {trip.reviews.map((review) => (
                  <li
                    key={review.id}
                    className="rounded-xl border border-line bg-white p-4"
                  >
                    <div className="flex items-center gap-2">
                      <RatingStars value={review.rating} size={14} />
                      <span className="text-[13px] font-medium">
                        empresa que mandó carga en este viaje
                      </span>
                      <span className="text-[13px] text-ink-muted">
                        → {review.toName}
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
        </div>

        {/* la columna del costado: lo que hace quien mira. En mobile va
            primero para quien tiene carga en el viaje o es el fletero. */}
        <aside
          aria-label={isCarrierOwner ? "tu viaje" : "tu carga"}
          className={`flex min-w-0 flex-col gap-6 lg:order-none ${
            isCarrierOwner || seesCargoList ? "order-first" : ""
          }`}
        >
          {isCarrierOwner && nextAction && (
            <div className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
              <div>
                <h2 className="font-display text-xl font-semibold">Este es tu viaje</h2>
                <p className="text-sm text-ink-soft">
                  {nextAction.status === "IN_TRANSIT"
                    ? "marcalo como en viaje cuando salgas."
                    : "marcalo como completado cuando termines."}
                </p>
              </div>
              <div className="grid gap-2">
                {/* D6 = a: cancelar solo antes de salir */}
                {canCancelTrip && (
                  <Button
                    variant="outline-danger"
                    size="md"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      updateStatus.reset();
                      setCancelTripOpen(true);
                    }}
                  >
                    Cancelar viaje
                  </Button>
                )}
                <Button
                  variant="dark"
                  size="md"
                  disabled={updateStatus.isPending}
                  onClick={() => {
                    // salir no tiene vuelta atrás (D3): pasa por «¿salís ahora?»
                    if (nextAction.status === "IN_TRANSIT") {
                      updateStatus.reset();
                      confirmCargoItem.reset();
                      setDepartOpen(true);
                      return;
                    }
                    updateStatus.mutate(nextAction.status);
                  }}
                >
                  {updateStatus.isPending && updateStatus.variables === nextAction.status
                    ? "marcando…"
                    : nextAction.label}
                </Button>
              </div>
            </div>
          )}

          {canDownloadManifest && (
            <div className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
              <div>
                <h2 className="font-display text-xl font-semibold">Remito del viaje</h2>
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
                {downloadManifest.isPending ? "generando…" : "Descargar remito"}
              </Button>
            </div>
          )}

          {downloadManifest.isError && (
            <p className="mt-2 text-sm text-ink-muted">
              {downloadManifest.error.message}
            </p>
          )}

          {!isCarrierOwner && (
            <>
              {seesCargoList && (
                <section className={isCarrierOwner ? "mt-10" : ""}>
                  <h2 className="font-display text-xl font-semibold">
                    {isCarrierOwner
                      ? "Cargas del viaje"
                      : trip.cargoItems.length > 1
                        ? "Tus cargas"
                        : "Tu carga"}
                  </h2>
                  {/* 03§1.4: el checklist de salida, para el fletero mientras no salió */}
                  {isCarrierOwner && canCancelTrip && trip.cargoItems.length > 0 && (
                    <p className="mt-2 rounded-md border border-surface-line bg-surface px-3 py-2 text-[13px] text-ink-soft">
                      <span className="font-medium text-ink">antes de salir:</span>{" "}
                      confirmá las cargas con seña pagada ({departure.confirmed.length} de{" "}
                      {departure.withDeposit}). las cargas sin confirmar se cancelan
                      cuando marcás el viaje en tránsito, y a cada empresa le devolvemos
                      la seña que haya pagado.
                    </p>
                  )}
                  {trip.cargoItems.length === 0 && (
                    <p className="mt-2 text-sm text-ink-muted">
                      todavía no hay carga asignada a este viaje.
                    </p>
                  )}
                  <ul className="mt-3 space-y-3" aria-label="cargas del viaje">
                    {trip.cargoItems.map((item) => {
                      const deposit = item.depositPayment;
                      const balance = item.balancePayment;
                      // del server (L7): el client no resta montos
                      const balanceAmount = item.balanceAmount;
                      const isCancelled = item.status === "CANCELLED";
                      const isCompany = user?.id === item.companyId;
                      const depositApproved = deposit?.status === "APPROVED";
                      // un contracargo no se vuelve a pagar: lo resuelve un admin
                      const chargedBack =
                        deposit?.status === "CHARGED_BACK" ||
                        balance?.status === "CHARGED_BACK";
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
                        !depositApproved &&
                        !chargedBack;
                      const showBalancePayButton =
                        isCompany &&
                        balanceDue &&
                        balance?.status !== "APPROVED" &&
                        balance?.status !== "CHARGED_BACK";
                      const showPayButton = showDepositPayButton || showBalancePayButton;
                      const paymentError = paymentErrorFor(item.id);
                      // el fletero desconectó Mercado Pago: reintentar no sirve, así
                      // que el botón queda deshabilitado con el motivo
                      const cannotCharge =
                        paymentError instanceof ApiError &&
                        paymentError.code === "MP_ACCOUNT_NOT_CONNECTED";
                      // se retira lo pendiente o confirmado (hasta la salida, con la misma
                      // penalidad) mientras el viaje no arrancó: el botón vive al lado
                      // de las otras acciones.
                      const showCancelButton =
                        isCompany &&
                        (item.status === "PENDING" || item.status === "CONFIRMED") &&
                        canCancelTrip;
                      return (
                        // RD3 / QW13: en mobile la fila se apila (estado, datos y
                        // botones a lo ancho); en desktop vuelve a ser una línea
                        <li
                          key={item.id}
                          id={`carga-${item.id}`}
                          className={`flex flex-col gap-3 rounded-xl border bg-white p-4 ${
                            !isCarrierOwner
                              ? ""
                              : "sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                          } ${
                            item.id === justAddedId
                              ? "border-success ring-2 ring-success-bg"
                              : "border-line"
                          }`}
                        >
                          <div
                            className={`flex min-w-0 flex-col gap-2 ${
                              !isCarrierOwner
                                ? ""
                                : "sm:flex-row sm:items-center sm:gap-3"
                            }`}
                          >
                            <div
                              className={`flex flex-wrap items-center gap-2 ${!isCarrierOwner ? "" : "sm:contents"}`}
                            >
                              {depositApproved && <Chip tone="ok">seña pagada</Chip>}
                              {balance?.status === "APPROVED" && (
                                <Chip tone="ok">saldo pagado</Chip>
                              )}
                              {!showPayButton && (
                                <Chip tone={CARGO_STATUS_TONES[item.status]}>
                                  {item.status === "CANCELLED"
                                    ? cancelledLabel(item.cancellationReason)
                                    : CARGO_STATUS_LABELS[item.status]}
                                </Chip>
                              )}
                            </div>
                            <div className="min-w-0">
                              {/* RD7: el aviso de la reserva, en la fila donde se paga */}
                              {item.id === justAddedId && (
                                <p
                                  role="status"
                                  className="mb-1 text-[13px] font-medium text-success-deep"
                                >
                                  {showDepositPayButton
                                    ? "listo, reservaste tu lugar. pagá la seña para confirmarlo."
                                    : "listo, reservaste tu lugar."}
                                </p>
                              )}
                              <p className="font-semibold text-ink">{item.description}</p>
                              <p className="text-[13px] text-ink-muted">
                                {item.volume.toFixed(1)} m³ · {currency(item.priceShare)}{" "}
                                del viaje
                              </p>
                              {user?.role === "CARRIER" &&
                                user?.id === trip.carrierId &&
                                carrierNetOf(item) !== null && (
                                  <p className="text-[12px] text-success-deep font-medium">
                                    tu neto: {currency(carrierNetOf(item) ?? 0)} (comisión{" "}
                                    {trip.platformFeePercent}%)
                                  </p>
                                )}
                              {item.pickupAddress && (
                                <p className="text-[12px] text-ink-muted font-mono break-words">
                                  retiro: {item.pickupAddress}
                                </p>
                              )}
                              {item.trackingCode && (
                                <p className="text-[12px] text-ink-muted font-mono break-all">
                                  código: {item.trackingCode}
                                </p>
                              )}
                              {showDepositPayButton && (
                                <p className="text-[13px] text-ink-muted">
                                  seña de {currency(item.depositAmount)} para reservar el
                                  lugar · quedan {currency(balanceAmount)} al salir
                                </p>
                              )}
                              {/* 03§1.2 / QW12: hasta cuándo vale la reserva sin seña */}
                              {showDepositPayButton && item.reservationExpiresAt && (
                                <p
                                  className={`text-[13px] ${
                                    new Date(item.reservationExpiresAt).getTime() - now <
                                    RESERVATION_URGENT_MS
                                      ? "font-medium text-danger"
                                      : "text-ink-muted"
                                  }`}
                                >
                                  reservado hasta el{" "}
                                  {formatInstant(item.reservationExpiresAt)}. si no pagás
                                  la seña antes, el lugar se libera.
                                </p>
                              )}
                              {/* 03§1.3: con la seña paga, el saldo no se pierde de vista */}
                              {isCompany &&
                                depositApproved &&
                                !isCancelled &&
                                (trip.status === "OPEN" || trip.status === "FULL") &&
                                balanceAmount > 0 && (
                                  <p className="text-[13px] text-ink-muted">
                                    el saldo de {currency(balanceAmount)} se paga cuando
                                    el viaje sale.
                                  </p>
                                )}
                              {balanceDue &&
                                balance?.status !== "APPROVED" &&
                                balance?.status !== "CHARGED_BACK" && (
                                  <p className="text-[13px] text-ink-muted">
                                    saldo de {currency(balanceAmount)} pendiente
                                  </p>
                                )}
                              {chargedBack && (
                                <p className="text-[13px] text-ink-muted">
                                  el pago tiene un contracargo en Mercado Pago: lo revisa
                                  un admin.
                                </p>
                              )}
                              {/* D1: el fletero sabe por qué todavía no puede confirmar */}
                              {isCarrierOwner &&
                                item.status === "PENDING" &&
                                !depositApproved &&
                                !chargedBack && (
                                  <p className="text-[13px] text-ink-muted">
                                    {item.reservationExpiresAt
                                      ? `esperando la seña de la empresa (vence ${formatInstant(item.reservationExpiresAt)})`
                                      : "esperando que se acredite la seña de la empresa"}
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
                              {isCompany && !isCancelled && (
                                <MoneyTimeline
                                  className="mt-4 mb-1"
                                  steps={moneySteps(item, trip, balanceDue)}
                                />
                              )}
                              {showPayButton && paymentError && (
                                <p role="alert" className="mt-1 text-[13px] text-danger">
                                  {cannotCharge
                                    ? `este viaje no puede recibir pagos por ahora.${
                                        item.reservationExpiresAt
                                          ? ` tu lugar queda reservado hasta el ${formatInstant(item.reservationExpiresAt)}.`
                                          : ""
                                      }`
                                    : paymentError.message}
                                </p>
                              )}
                            </div>
                          </div>
                          {showPayButton || showCancelButton ? (
                            <div
                              className={`flex flex-col gap-2 ${
                                !isCarrierOwner
                                  ? ""
                                  : "sm:shrink-0 sm:flex-row sm:items-center"
                              }`}
                            >
                              {showCancelButton && (
                                <Button
                                  variant="outline-danger"
                                  size="sm"
                                  className={
                                    !isCarrierOwner ? STACKED_ACTION : ROW_ACTION
                                  }
                                  disabled={cancelCargoItem.isPending}
                                  onClick={() => {
                                    cancelCargoItem.reset();
                                    setWithdrawItemId(item.id);
                                  }}
                                >
                                  Retirar carga
                                </Button>
                              )}
                              {showPayButton && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  className={
                                    !isCarrierOwner ? STACKED_ACTION : ROW_ACTION
                                  }
                                  disabled={
                                    createPaymentPreference.isPending || cannotCharge
                                  }
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
                                      ? `Pagar saldo ${currency(balanceAmount)}`
                                      : `Pagar seña ${currency(item.depositAmount)}`}
                                </Button>
                              )}
                            </div>
                          ) : (
                            item.status === "PENDING" &&
                            depositApproved &&
                            canConfirm && (
                              <Button
                                variant="primary"
                                size="sm"
                                className={!isCarrierOwner ? STACKED_ACTION : ROW_ACTION}
                                disabled={confirmCargoItem.isPending}
                                onClick={() => confirmCargoItem.mutate(item.id)}
                              >
                                Confirmar carga
                              </Button>
                            )
                          )}
                        </li>
                      );
                    })}
                    {/* las cargas de otras empresas: el volumen y la localidad del
                  retiro, nunca la dirección (U7, L6) */}
                    {trip.otherCargo.map((other, i) => (
                      <li
                        key={`otra-${i}`}
                        className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 text-sm text-ink-soft"
                      >
                        <span
                          aria-hidden="true"
                          className="size-4 shrink-0 rounded-[3px] bg-hatch"
                        />
                        otra carga ·{" "}
                        {other.volume.toLocaleString("es-AR", {
                          maximumFractionDigits: 1,
                        })}{" "}
                        m³
                        {other.pickupCity && ` · retiro en ${other.pickupCity}`}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {actionError && (
                <p className="mt-4 text-[13px] text-danger">{actionError}</p>
              )}
            </>
          )}

          {/* el fletero no carga en su propio viaje */}
          {trip.viewerAccess !== "CARRIER_OWNER" && (
            <form
              onSubmit={handleAddCargo}
              className="rounded-xl border border-line bg-white p-5 sm:p-6"
            >
              <h2 className="font-display text-xl font-semibold">
                Sumar carga a este viaje
              </h2>
              {/* La fecha manda aunque el estado siga OPEN: un viaje de hoy ya no
                admite cargas, y el badge sigue mostrando el estado real. */}
              {trip.status === "OPEN" && !trip.acceptsCargo && (
                <p className="mt-2 text-[13px] text-ink-muted">
                  este viaje ya comenzó y no admite cargas nuevas.
                </p>
              )}
              {trip.status !== "OPEN" && (
                <p className="mt-2 text-[13px] text-ink-muted">
                  este viaje está {TRIP_STATUS_LABELS[trip.status]} y ya no admite cargas
                  nuevas.
                </p>
              )}
              {trip.acceptsCargo && !user && (
                <p className="mt-2 text-[13px] text-ink-muted">
                  para sumar carga necesitás una cuenta de empresa:{" "}
                  <Link
                    to={loginLink({ tab: "register", role: "company" })}
                    className="text-brand underline"
                  >
                    crear cuenta
                  </Link>{" "}
                  ·{" "}
                  <Link to={loginLink()} className="text-brand underline">
                    ingresar
                  </Link>
                </p>
              )}
              {trip.acceptsCargo && user && user.role !== "COMPANY" && (
                <p className="mt-2 text-[13px] text-ink-muted">
                  para sumar carga necesitás una cuenta de empresa.{" "}
                  <Link
                    to={loginLink({ tab: "register", role: "company" })}
                    className="text-brand underline"
                  >
                    crear cuenta de empresa
                  </Link>
                </p>
              )}
              {canAddCargo && trip.acceptsCargo && (
                <>
                  <div className="mt-4 grid gap-4">
                    <div>
                      <label className="field-label" htmlFor="description">
                        Qué mandás
                      </label>
                      <input
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="ej: heladera, 6 sillas, 10 cajas"
                        className="input mt-1.5"
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="volume">
                        Volumen (m³)
                      </label>
                      <input
                        id="volume"
                        value={volume}
                        onChange={(e) => setVolume(e.target.value)}
                        placeholder="ej: 1.5"
                        inputMode="decimal"
                        className="input mt-1.5"
                      />
                    </div>
                    <PickupAddressField
                      value={pickupAddress}
                      onChange={setPickupAddress}
                      error={formError ?? undefined}
                    />
                  </div>

                  {/* 03§1.3: lo que se va a pagar, con los montos del server */}
                  <div className="mt-5 rounded-lg bg-soft p-4 text-sm text-ink-soft">
                    {cargoQuote.quote ? (
                      <p aria-live="polite">
                        {cargoQuote.quote.volume.toLocaleString("es-AR", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        m³: {currency(cargoQuote.quote.priceShare)}. hoy pagás la seña de{" "}
                        {currency(cargoQuote.quote.depositAmount)}; el saldo de{" "}
                        {currency(cargoQuote.quote.balanceAmount)} se paga cuando el viaje
                        sale.
                      </p>
                    ) : cargoQuote.isError ? (
                      <p aria-live="polite">
                        no pudimos calcular el precio ahora: lo ves al reservar.
                      </p>
                    ) : (
                      <p>escribí el volumen y te mostramos cuánto pagás.</p>
                    )}
                    {/* 03§1.2: la política de retiro antes de reservar */}
                    <p className="mt-2">
                      reservás el lugar por 24 h. para confirmarlo pagás una seña del{" "}
                      {trip.depositPercent} %. si retirás la carga: más de 48 h antes de
                      la salida te devolvemos toda la seña, entre 24 y 48 h la mitad, con
                      menos de 24 h no hay devolución.
                    </p>
                  </div>

                  <Button
                    type="submit"
                    size="md"
                    variant={hasOwnActiveCargo ? "dark" : "primary"}
                    disabled={addCargoItem.isPending}
                    className="mt-5 w-full"
                  >
                    {addCargoItem.isPending ? "sumando…" : "Sumar carga"}
                  </Button>
                </>
              )}
            </form>
          )}
        </aside>

        <CancelTripDialog
          open={cancelTripOpen}
          items={trip.cargoItems}
          onCancel={() => setCancelTripOpen(false)}
          onConfirm={() =>
            updateStatus.mutate("CANCELLED", {
              onSuccess: () => setCancelTripOpen(false),
            })
          }
          pending={updateStatus.isPending}
          error={
            updateStatus.error instanceof Error && updateStatus.variables === "CANCELLED"
              ? updateStatus.error.message
              : null
          }
        />

        <DepartTripDialog
          open={departOpen}
          items={trip.cargoItems}
          onCancel={() => setDepartOpen(false)}
          onDepart={() =>
            updateStatus.mutate("IN_TRANSIT", { onSuccess: () => setDepartOpen(false) })
          }
          departing={updateStatus.isPending}
          onConfirmCargo={(cargoItemId) => confirmCargoItem.mutate(cargoItemId)}
          confirmingId={
            confirmCargoItem.isPending ? (confirmCargoItem.variables ?? null) : null
          }
          error={
            updateStatus.error instanceof Error && updateStatus.variables === "IN_TRANSIT"
              ? updateStatus.error.message
              : confirmCargoItem.error instanceof Error
                ? confirmCargoItem.error.message
                : null
          }
        />

        {/* el error del retiro se ve dentro del diálogo, no abajo de todo */}
        <WithdrawCargoDialog
          tripId={trip.id}
          tripStatus={trip.status}
          item={trip.cargoItems.find((c) => c.id === withdrawItemId) ?? null}
          onCancel={() => setWithdrawItemId(null)}
          onConfirm={(cargoItemId) =>
            cancelCargoItem.mutate(cargoItemId, {
              onSuccess: () => setWithdrawItemId(null),
            })
          }
          pending={cancelCargoItem.isPending}
          error={
            cancelCargoItem.error instanceof Error ? cancelCargoItem.error.message : null
          }
        />

        {stopDistanceError && (
          <Modal
            isOpen={!!stopDistanceError}
            onClose={() => setStopDistanceError(null)}
            title="Parada fuera del trayecto"
          >
            <p className="text-sm text-ink-soft whitespace-pre-line">
              {stopDistanceError}
            </p>
            <p className="mt-3 text-xs text-ink-muted">
              Por favor, elegí una dirección de retiro más cercana al recorrido del viaje.
            </p>
          </Modal>
        )}
        {tripStartedError && (
          <Modal
            isOpen={!!tripStartedError}
            onClose={() => setTripStartedError(null)}
            title="El viaje ya está en curso"
          >
            <p className="text-sm text-ink-soft whitespace-pre-line">
              {tripStartedError}
            </p>
            <p className="mt-3 text-xs text-ink-muted">
              Un viaje deja de aceptar cargas nuevas el día de su salida. Podés seguir
              consultando el viaje y las cargas que ya tenés en él.
            </p>
          </Modal>
        )}
      </main>
    </div>
  );
}
