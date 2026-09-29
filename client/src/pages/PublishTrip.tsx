import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { FEATURE_META } from "../lib/tripFeatures";
import { useAuth } from "../hooks/useAuth";
import { useCreateTrip } from "../hooks/useCreateTrip";
import { useMyProfile } from "../hooks/useUserProfile";
import { usePlaceField } from "../hooks/usePlaceField";
import { usePriceEstimate } from "../hooks/usePriceEstimate";
import { LazyTripPinMap } from "../components/LazyTripPinMap";
import { TRIP_FEATURES } from "../types/trip";
import type { TripFeature } from "../types/trip";

const TRUCK_TYPES = ["Semi", "Chasis", "Tráiler", "Camión"];

const inputClass =
  "mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand";

function parseDecimalInput(raw: string): number {
  return Number(raw.trim().replace(",", "."));
}

function currency(n: number): string {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function formatInputDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// mismo regex que el server: "25:00" o "8:30" son errores, no fechas que JS
// normaliza en silencio.
const DEPARTURE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "-31.4201, -64.1888": el pin tiene que ser confirmable con los números a la vista. */
function formatPoint(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

type PlaceKind = "origen" | "destino";

/**
 * Lo que el fletero necesita ver antes de publicar: dónde cayó el pin. Si el
 * geocode no encontró el lugar, lo decimos (el viaje se publica igual, pero sin
 * coordenadas no va a aparecer en los mapas ni en las búsquedas por radio).
 */
function PlaceHint({
  place,
  kind,
}: {
  place: ReturnType<typeof usePlaceField>;
  kind: PlaceKind;
}) {
  if (place.resolving) {
    return <p className="mt-1 text-xs text-ink-muted">buscando el {kind}…</p>;
  }
  if (place.notFound) {
    return (
      <p className="mt-1 text-xs text-ink-muted">
        no encontramos ese {kind}. podés publicarlo igual, pero no va a aparecer en el
        mapa ni en las búsquedas por radio.
      </p>
    );
  }
  if (!place.point) return null;
  return (
    <p className="mt-1 text-xs text-ink-muted">
      pin del {kind}: {formatPoint(place.point)}
      {place.movedByHand ? " (lo moviste vos)" : " — revisá que sea el lugar correcto"}
    </p>
  );
}

export default function PublishTrip() {
  const navigate = useNavigate();
  const createTrip = useCreateTrip();
  const { user, isLoading: authLoading } = useAuth();
  const canPublish = user?.role === "CARRIER";
  // el server exige VERIFIED; el perfil trae el estado para explicar el bloqueo
  // antes de que el usuario llene el formulario.
  const { data: profile, isLoading: profileLoading } = useMyProfile(canPublish);
  const isVerified = profile?.verificationStatus === "VERIFIED";
  const isPendingVerification =
    profile?.verificationStatus === "UNVERIFIED" ||
    profile?.verificationStatus === "REJECTED" ||
    profile?.verificationStatus === "PENDING";

  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");
  const [truckType, setTruckType] = useState(TRUCK_TYPES[0]);
  const [capacityTotal, setCapacityTotal] = useState("");
  const [price, setPrice] = useState("");
  const [depositPercent, setDepositPercent] = useState("20");
  const [departureTime, setDepartureTime] = useState("");
  const [features, setFeatures] = useState<TripFeature[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Cada extremo tiene su estado de geocode: el pin se mueve solo con lo que
  // el fletero escribe y queda en sus manos si lo corrige a mano.
  const originPlace = usePlaceField(origin);
  const destinationPlace = usePlaceField(destination);

  // Precio sugerido según distancia y vehículo. Cuando hay sugerencia, el
  // precio deja de ser un input libre y pasa a ser un control acotado al rango
  // que devuelve la API (±15%); sin sugerencia (geocode caído) queda libre.
  const { estimate } = usePriceEstimate(origin, destination, truckType);
  // geocoded:false viene con los números en null, así que el narrowing se hace
  // una vez acá y el resto del form trabaja con number sin interrogantes
  const rango = estimate?.geocoded
    ? {
        distanceKm: estimate.distanceKm as number,
        suggestedPrice: estimate.suggestedPrice as number,
        minPrice: estimate.minPrice as number,
        maxPrice: estimate.maxPrice as number,
      }
    : null;

  // Cada vez que llega una sugerencia distinta (otra ruta, otro vehículo) el
  // precio vuelve al medio del rango: lo que el fletero había elegido era para
  // un viaje que ya no es este.
  const estimateKey = rango
    ? `${rango.suggestedPrice}:${rango.minPrice}:${rango.maxPrice}`
    : null;
  const [lastEstimateKey, setLastEstimateKey] = useState<string | null>(null);
  if (estimateKey !== lastEstimateKey) {
    setLastEstimateKey(estimateKey);
    if (rango) setPrice(String(rango.suggestedPrice));
  }

  // el slider es un <input type="range">: si le pasamos "" o un NaN se rompe.
  // Ante cualquier valor raro cae al sugerido, que siempre está en el rango.
  const parsedPrice = parseDecimalInput(price);
  const sliderValue = rango
    ? Number.isFinite(parsedPrice)
      ? Math.min(rango.maxPrice, Math.max(rango.minPrice, parsedPrice))
      : rango.suggestedPrice
    : 0;

  function toggleFeature(feature: TripFeature) {
    setFeatures((current) =>
      current.includes(feature)
        ? current.filter((f) => f !== feature)
        : [...current, feature]
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsedCapacity = parseDecimalInput(capacityTotal);
    const parsedPrice = parseDecimalInput(price);
    const parsedDeposit = parseDecimalInput(depositPercent);

    if (!origin.trim() || !destination.trim()) {
      setFormError("completá origen y destino.");
      return;
    }
    if (origin.trim().toLowerCase() === destination.trim().toLowerCase()) {
      setFormError("origen y destino no pueden ser iguales.");
      return;
    }
    if (!date || new Date(date) <= new Date()) {
      setFormError("elegí una fecha válida en el futuro.");
      return;
    }
    if (Number.isNaN(parsedCapacity) || parsedCapacity <= 0) {
      setFormError("ingresá una capacidad válida en m³.");
      return;
    }
    if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
      setFormError("ingresá un precio válido.");
      return;
    }
    if (departureTime && !DEPARTURE_TIME.test(departureTime)) {
      setFormError("la hora de salida tiene que tener formato HH:mm.");
      return;
    }
    if (!Number.isInteger(parsedDeposit) || parsedDeposit < 10 || parsedDeposit > 50) {
      setFormError("la seña va entre 10% y 50%.");
      return;
    }

    createTrip.mutate(
      {
        origin: origin.trim(),
        destination: destination.trim(),
        date: new Date(`${date}T12:00:00`).toISOString(),
        // sin hora, el viaje se publica igual: es un dato opcional
        ...(departureTime ? { departureTime } : {}),
        truckType,
        capacityTotal: parsedCapacity,
        price: parsedPrice,
        depositPercent: parsedDeposit,
        features,
      },
      {
        onSuccess: (trip) => navigate(`/viajes/${trip.id}`),
        onError: (err: unknown) => {
          setFormError(
            err instanceof Error ? err.message : "no se pudo publicar el viaje."
          );
        },
      }
    );
  }

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">Publicar un viaje</h1>
        <p className="mt-1 text-sm text-ink-soft">
          contanos tu recorrido y el espacio libre que tenés en el camión.
        </p>

        {authLoading && (
          <p className="mt-8 text-sm text-ink-muted">revisando tu sesión…</p>
        )}

        {!authLoading && !canPublish && (
          <div className="mt-8 rounded-[10px] border border-line bg-white p-6">
            <p className="text-sm text-ink-muted">
              para publicar un viaje necesitás una cuenta de fletero:{" "}
              <Link
                to="/ingresar?tab=register&role=carrier"
                className="text-brand underline"
              >
                crear cuenta
              </Link>{" "}
              ·{" "}
              <Link to="/ingresar" className="text-brand underline">
                ingresar
              </Link>
            </p>
          </div>
        )}

        {!authLoading && canPublish && (profileLoading || !profile) && (
          <p className="mt-8 text-sm text-ink-muted">revisando tu verificación…</p>
        )}

        {!authLoading && canPublish && profile && isPendingVerification && (
          <div className="mt-8 rounded-[10px] border border-line bg-white p-6">
            <p className="text-sm font-medium text-ink">
              {profile.verificationStatus === "PENDING"
                ? "estamos revisando tu identidad"
                : "necesitás verificar tu identidad para publicar"}
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              {profile.verificationStatus === "PENDING"
                ? "tu solicitud está en revisión. apenas la aprobemos vas a poder publicar viajes."
                : "cargá tu DNI o CUIT en tu perfil y esperá la aprobación para poder publicar viajes."}
            </p>
            {profile.verificationStatus === "REJECTED" && profile.verificationNote && (
              <p className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
                motivo del rechazo: {profile.verificationNote}
              </p>
            )}
            <Button asChild variant="primary" size="sm" className="mt-4">
              <Link to="/perfil">
                {profile.verificationStatus === "PENDING"
                  ? "ver estado en mi perfil"
                  : "verificar mi identidad"}
              </Link>
            </Button>
          </div>
        )}

        {!authLoading && canPublish && profile && isVerified && !profile.mpConnected && (
          <div className="mt-8 rounded-[10px] border border-line bg-white p-6">
            <p className="text-sm font-medium text-ink">
              para publicar viajes debés conectar tu cuenta de Mercado Pago
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              es necesario para recibir pagos con split automático: la plataforma retiene
              su comisión y vos recibís tu parte neta directamente.
            </p>
            <Button asChild variant="primary" size="sm" className="mt-4">
              <Link to="/perfil">conectar Mercado Pago</Link>
            </Button>
          </div>
        )}

        {!authLoading && canPublish && profile && isVerified && profile.mpConnected && (
          <form
            onSubmit={handleSubmit}
            className="mt-8 rounded-[10px] border border-line bg-white p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-[13px] text-ink-soft" htmlFor="origin">
                  origen
                </label>
                <input
                  id="origin"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="ej: Córdoba"
                  className={inputClass}
                />
                <PlaceHint place={originPlace} kind="origen" />
              </div>
              <div>
                <label className="text-[13px] text-ink-soft" htmlFor="destination">
                  destino
                </label>
                <input
                  id="destination"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="ej: Rosario"
                  className={inputClass}
                />
                <PlaceHint place={destinationPlace} kind="destino" />
              </div>
            </div>

            <div className="mt-4">
              <LazyTripPinMap
                className="h-72 w-full"
                origin={originPlace.point}
                destination={destinationPlace.point}
                onOriginChange={originPlace.setPointByHand}
                onDestinationChange={destinationPlace.setPointByHand}
                fitKey={`${originPlace.resolvedFor ?? ""}|${destinationPlace.resolvedFor ?? ""}`}
              />
              <p className="mt-2 text-xs text-ink-muted">
                {originPlace.point || destinationPlace.point
                  ? " revisá los pines: si alguno cayó en el lugar equivocado, movelo. el pin de salida es el azul y el de llegada el naranja."
                  : " escribí origen y destino y los ubicamos en el mapa. después podés corregir cada pin a mano."}
              </p>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              <div>
                <label className="text-[13px] text-ink-soft" htmlFor="date">
                  fecha de salida
                </label>
                <input
                  id="date"
                  type="date"
                  value={date}
                  min={formatInputDate(new Date())}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-[13px] text-ink-soft" htmlFor="departureTime">
                  hora de salida
                </label>
                <input
                  id="departureTime"
                  type="time"
                  value={departureTime}
                  onChange={(e) => setDepartureTime(e.target.value)}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-muted">opcional.</p>
              </div>
              <div>
                <label className="text-[13px] text-ink-soft" htmlFor="truckType">
                  vehículo
                </label>
                <select
                  id="truckType"
                  value={truckType}
                  onChange={(e) => setTruckType(e.target.value)}
                  className={inputClass}
                >
                  {TRUCK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[13px] text-ink-soft" htmlFor="capacityTotal">
                  capacidad (m³)
                </label>
                <input
                  id="capacityTotal"
                  value={capacityTotal}
                  onChange={(e) => setCapacityTotal(e.target.value)}
                  placeholder="ej: 30"
                  inputMode="decimal"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="mt-4">
              <span className="text-[13px] text-ink-soft">servicios y extras</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {TRIP_FEATURES.map((feature) => {
                  const { label, Icon } = FEATURE_META[feature];
                  const active = features.includes(feature);
                  return (
                    <label
                      key={feature}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                        active
                          ? "border-brand bg-canvas text-ink"
                          : "border-line text-ink-soft"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleFeature(feature)}
                        className="checkbox"
                      />
                      <Icon
                        size={16}
                        aria-hidden
                        className={active ? "text-brand" : ""}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <label className="text-[13px] text-ink-soft" htmlFor="price">
                precio del viaje
              </label>
              {rango ? (
                <>
                  <p className="mt-1 text-sm text-ink-muted">
                    {Math.round(rango.distanceKm)} km · sugerido:{" "}
                    {currency(rango.suggestedPrice)}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <input
                      id="price"
                      type="range"
                      min={rango.minPrice}
                      max={rango.maxPrice}
                      step={100}
                      value={sliderValue}
                      onChange={(e) => setPrice(e.target.value)}
                      aria-describedby="priceRange"
                      className="w-full accent-brand"
                    />
                    <span className="w-24 shrink-0 text-right font-medium text-brand">
                      {currency(sliderValue)}
                    </span>
                  </div>
                  <p id="priceRange" className="mt-1 text-xs text-ink-muted">
                    entre {currency(rango.minPrice)} y {currency(rango.maxPrice)}: es el
                    rango razonable para esta ruta, así las empresas pueden comparar
                    precios entre viajes.
                  </p>
                </>
              ) : (
                <>
                  <input
                    id="price"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="ej: 1500"
                    inputMode="decimal"
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-ink-muted">
                    no pudimos calcular una sugerencia, ingresalo vos. el precio se
                    prorratea entre las cargas según el volumen que ocupen.
                  </p>
                </>
              )}
            </div>

            <div className="mt-4">
              <label className="text-[13px] text-ink-soft" htmlFor="depositPercent">
                seña que deja cada empresa (%)
              </label>
              <input
                id="depositPercent"
                value={depositPercent}
                onChange={(e) => setDepositPercent(e.target.value)}
                placeholder="ej: 20"
                inputMode="numeric"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-ink-muted">
                es lo que paga la empresa al reservar espacio (entre 10% y 50%). el resto
                se cobra cuando el viaje sale. si retiran la carga: más de 48hs antes se
                devuelve toda la seña, entre 24 y 48hs la mitad, y con menos de 24hs no se
                devuelve.
              </p>
            </div>

            {formError && <p className="mt-4 text-[13px] text-danger">{formError}</p>}

            <Button type="submit" className="mt-6 w-full" disabled={createTrip.isPending}>
              {createTrip.isPending ? "publicando…" : "publicar viaje"}
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}
