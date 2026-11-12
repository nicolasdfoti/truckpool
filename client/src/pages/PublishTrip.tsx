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

type PlaceKind = "origen" | "destino" | "punto de salida";

/**
 * Lo que el fletero necesita ver antes de publicar: qué lugar entendimos, en
 * texto y con el país ("Córdoba, Córdoba, Argentina"). Las coordenadas quedan
 * solo si el server no informó el lugar. Si el geocode no lo encontró, lo
 * decimos (el viaje se publica igual, pero sin coordenadas no va a aparecer en
 * los mapas ni en las búsquedas por radio).
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
      {place.label ? (
        <>
          {kind}: <span className="text-ink">{place.label}</span>
        </>
      ) : (
        <>
          pin del {kind}: {formatPoint(place.point)}
        </>
      )}{" "}
      — revisá que sea el lugar correcto
    </p>
  );
}

/** "40 % arriba", "12 % abajo": cuánto se aleja el precio del sugerido */
function deviationText(price: number, suggested: number): string {
  const percent = Math.round((Math.abs(price - suggested) / suggested) * 100);
  return `${percent} % ${price > suggested ? "arriba" : "abajo"}`;
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
  // punto exacto de salida (depósito/galpón). opcional: si queda vacío se usa
  // el origin general como punto de partida en el mapa del recorrido.
  const [departureAddress, setDepartureAddress] = useState("");
  const [date, setDate] = useState("");
  const [truckType, setTruckType] = useState(TRUCK_TYPES[0]);
  const [capacityTotal, setCapacityTotal] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [depositPercent, setDepositPercent] = useState("20");
  const [departureTime, setDepartureTime] = useState("");
  const [features, setFeatures] = useState<TripFeature[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Cada extremo tiene su estado de geocode: el pin y el lugar en texto siguen
  // a lo que el fletero escribe (el pin no se arrastra, ver usePlaceField).
  const originPlace = usePlaceField(origin);
  const destinationPlace = usePlaceField(destination);
  const departurePlace = usePlaceField(departureAddress);

  // Precio sugerido según distancia y vehículo (D5): es una referencia. El
  // precio lo pone el fletero y salir del ±15 % solo muestra un aviso.
  const { estimate } = usePriceEstimate(origin, destination, truckType);
  // los números vienen todos o ninguno: geocoded:false (geocode caído) o más
  // de 5.000 km (una punta mal resuelta) los traen en null
  const sugerencia =
    estimate?.geocoded &&
    estimate.distanceKm !== null &&
    estimate.suggestedPrice !== null &&
    estimate.minPrice !== null &&
    estimate.maxPrice !== null
      ? {
          distanceKm: estimate.distanceKm,
          suggestedPrice: estimate.suggestedPrice,
          minPrice: estimate.minPrice,
          maxPrice: estimate.maxPrice,
        }
      : null;
  const tooFarKm =
    estimate?.geocoded && !sugerencia && estimate.distanceKm !== null
      ? estimate.distanceKm
      : null;

  // Mientras el fletero no escribió un precio, el campo muestra el sugerido (y
  // lo sigue si cambia la ruta o el vehículo). Lo que escribe a mano no se pisa
  // nunca; "usar el sugerido" vuelve a la precarga.
  const shownPrice =
    !priceTouched && sugerencia ? String(sugerencia.suggestedPrice) : price;
  const parsedPrice = parseDecimalInput(shownPrice);
  const outOfRange =
    sugerencia &&
    Number.isFinite(parsedPrice) &&
    parsedPrice > 0 &&
    (parsedPrice < sugerencia.minPrice || parsedPrice > sugerencia.maxPrice);

  function applySuggestedPrice() {
    setPrice("");
    setPriceTouched(false);
  }

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
    const parsedPrice = parseDecimalInput(shownPrice);
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
    if (!departureTime) {
      setFormError("ingresá la hora de salida.");
      return;
    }
    if (!DEPARTURE_TIME.test(departureTime)) {
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
        // sin punto exacto, el mapa del recorrido arranca en el origin general
        ...(departureAddress.trim() ? { departureAddress: departureAddress.trim() } : {}),
        date: new Date(`${date}T12:00:00`).toISOString(),
        // obligatoria: la política de retiro se mide contra la salida
        departureTime,
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
              <label className="text-[13px] text-ink-soft" htmlFor="departureAddress">
                punto exacto de salida
              </label>
              <input
                id="departureAddress"
                value={departureAddress}
                onChange={(e) => setDepartureAddress(e.target.value)}
                placeholder="opcional — ej: depósito en Av. Colón 1234, Córdoba"
                className={inputClass}
              />
              {departureAddress.trim() ? (
                <PlaceHint place={departurePlace} kind="punto de salida" />
              ) : (
                <p className="mt-1 text-xs text-ink-muted">
                  opcional. si lo completás, el mapa del recorrido arranca en este punto
                  en vez de en el origen general.
                </p>
              )}
            </div>

            <div className="mt-4">
              <LazyTripPinMap
                className="h-72 w-full"
                origin={originPlace.point}
                destination={destinationPlace.point}
                departure={departurePlace.point}
                fitKey={`${departurePlace.resolvedFor ?? ""}|${originPlace.resolvedFor ?? ""}|${destinationPlace.resolvedFor ?? ""}`}
              />
              <p className="mt-2 text-xs text-ink-muted">
                {originPlace.point || destinationPlace.point || departurePlace.point
                  ? "revisá los pines: si alguno cayó en el lugar equivocado, completá la dirección (por ejemplo con la provincia). el pin de salida es el azul y el de llegada el naranja."
                  : "escribí origen y destino y los ubicamos en el mapa."}
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
                  required
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-muted">
                  los plazos para retirar una carga se cuentan desde esta hora.
                </p>
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
              <input
                id="price"
                value={shownPrice}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setPriceTouched(true);
                }}
                placeholder="ej: 1500"
                inputMode="decimal"
                aria-describedby="priceHelp"
                className={inputClass}
              />
              <div id="priceHelp">
                {sugerencia ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    sugerido {currency(sugerencia.suggestedPrice)} para{" "}
                    {Math.round(sugerencia.distanceKm)} km (entre{" "}
                    {currency(sugerencia.minPrice)} y {currency(sugerencia.maxPrice)}). es
                    una referencia para que las empresas comparen: el precio lo ponés vos.
                    {parsedPrice !== sugerencia.suggestedPrice && (
                      <>
                        {" "}
                        <button
                          type="button"
                          onClick={applySuggestedPrice}
                          className="text-brand underline"
                        >
                          usar el sugerido
                        </button>
                      </>
                    )}
                  </p>
                ) : tooFarKm !== null ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    no sugerimos precio: {Math.round(tooFarKm).toLocaleString("es-AR")} km
                    entre origen y destino no parece un viaje real. revisá los lugares.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-ink-muted">
                    no pudimos calcular una sugerencia, ingresalo vos. el precio se
                    prorratea entre las cargas según el volumen que ocupen.
                  </p>
                )}
                {sugerencia && outOfRange && (
                  <p role="status" className="mt-1 text-xs text-accent-text">
                    está {deviationText(parsedPrice, sugerencia.suggestedPrice)} del
                    sugerido ({currency(sugerencia.suggestedPrice)}). podés publicarlo
                    igual.
                  </p>
                )}
              </div>
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
