import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { LazyTripMap } from "../components/LazyTripMap";
import { useTrip } from "../hooks/useTrip";
import { useAuth } from "../hooks/useAuth";
import { usePostLocation } from "../hooks/usePostLocation";
import { useTripLocation } from "../hooks/useTripLocation";
import { distanceKm, type LatLng } from "../lib/geo";
import { LoadingBlock, SkeletonBar } from "../components/Loading";

// no posteamos en cada evento del watchPosition: el navegador puede reportar
// cambios de un metro y no vale ni una request. Solo pasa si venció el throttle
// y el camión se movió de verdad.
const THROTTLE_MS = 25_000;
const MIN_MOVE_KM = 0.1;

type GeoState = "idle" | "sharing" | "denied" | "unsupported";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function TrackTrip() {
  const { id } = useParams<{ id: string }>();
  const tripId = id ?? "";
  const { data: trip, isLoading: tripLoading, isError: tripError } = useTrip(tripId);
  const { user, isLoading: authLoading } = useAuth();
  const postLocation = usePostLocation(tripId);
  const isInTransit = trip?.status === "IN_TRANSIT";
  const { data: locationData } = useTripLocation(tripId, {
    enabled: Boolean(tripId),
    history: true,
    isInTransit,
  });

  const [geoState, setGeoState] = useState<GeoState>("idle");
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  // nota transitoria: perdimos señal gps pero el watch sigue vivo.
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<{ at: Date; point: LatLng } | null>(null);

  const watchId = useRef<number | null>(null);
  const lastSentAt = useRef(0);
  const lastSentPoint = useRef<LatLng | null>(null);

  function stopSharing() {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setGeoState("idle");
  }

  // si el viaje deja de estar en tránsito (o el usuario se va), soltamos el
  // watch: dejar el gps prendido sin purpose no sirve de nada y gasta batería.
  // el estado de la ui se deriva de isInTransit, así que acá no hace falta
  // setState (y eslint rightly se queja si lo hacemos dentro de un efecto).
  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    },
    []
  );
  useEffect(() => {
    if (isInTransit) return;
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, [isInTransit]);

  function startSharing() {
    setGeoMessage(null);
    // un intento anterior queda con sus timers: reiniciamos el throttle para
    // que el primer punto nuevo se mande al toque.
    if (!("geolocation" in navigator)) {
      setGeoState("unsupported");
      setGeoMessage("tu navegador no tiene gps. probá con chrome o safari actualizados.");
      return;
    }

    lastSentAt.current = 0;
    setGeoState("sharing");
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const now = Date.now();
        const previous = lastSentPoint.current;

        // primer punto siempre; después, throttle + movimiento real.
        const movedEnough =
          previous === null || distanceKm(previous, point) >= MIN_MOVE_KM;
        if (now - lastSentAt.current < THROTTLE_MS || !movedEnough) return;

        lastSentAt.current = now;
        lastSentPoint.current = point;
        postLocation.mutate(point, {
          onSuccess: () => setLastSent({ at: new Date(), point }),
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          // el permiso no se cambia en caliente: sí conviene cortar el watch.
          setGeoMessage(
            "sin permiso de ubicación. habilitalo en el candado de la barra de direcciones y volvé a intentar."
          );
          stopSharing();
          setGeoState("denied");
          return;
        }
        // sin señal o timeout NO cortamos el sharing: el watch sigue vivo y el
        // navegador nos vuelve a llamar cuando tenga una posición. cortarlo
        // acá cortaba el tracking en cada semáforo.
        setGeoNote("sigue buscando señal gps…");
      },
      // nada de timeout: en un watch significa "si no llega una posición en N ms,
      // fallá", y con el camión detenido eso pasa todo el tiempo. maximumAge es
      // lo que evita pedirle al gps una posición que ya tenemos.
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }

  // esperamos viaje y sesión: si decidimos el acceso con la sesión todavía sin
  // resolver, el transportista veía un instante el cartel de "no podés".
  if (tripLoading || authLoading) {
    return (
      <div className="bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-3xl px-4 py-12">
          <LoadingBlock label="buscando el viaje" className="space-y-4">
            <SkeletonBar className="h-7 w-1/2" />
            <SkeletonBar className="h-4 w-1/3" />
            <SkeletonBar className="h-64 w-full" />
          </LoadingBlock>
        </main>
      </div>
    );
  }

  if (tripError || !trip) {
    return (
      <div className="bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-3xl px-4 py-12">
          <h1 className="font-display text-2xl font-semibold">no encontramos el viaje</h1>
          <p className="mt-2 text-sm text-ink-soft">
            puede que el link esté viejo o mal escrito.
          </p>
          <Link to="/viajes" className="mt-4 inline-block text-sm text-brand underline">
            ver todos los viajes
          </Link>
        </main>
      </div>
    );
  }

  // solo el transportista del viaje comparte ubicación, y solo en tránsito.
  const isCarrierOwner = user?.role === "CARRIER" && user.id === trip.carrierId;
  if (!isCarrierOwner || !isInTransit) {
    return (
      <div className="bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-3xl px-4 py-12">
          <h1 className="font-display text-2xl font-semibold">
            no podés compartir la ubicación
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {!isCarrierOwner
              ? "solo el transportista de este viaje puede compartir su ubicación."
              : "este viaje no está en tránsito. marcá el viaje como en tránsito desde su detalle para empezar a compartir."}
          </p>
          <Link
            to={`/viajes/${trip.id}`}
            className="mt-4 inline-block text-sm text-brand underline"
          >
            ver el viaje
          </Link>
        </main>
      </div>
    );
  }

  const location = locationData?.location ?? null;
  const track = locationData?.track ?? [];
  // derivado, no guardado: si el viaje deja de estar en tránsito, la ui deja de
  // decir "compartiendo" aunque el watch ya esté muerto.
  const isSharing = geoState === "sharing" && isInTransit;

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link to={`/viajes/${trip.id}`} className="text-[13px] text-ink-soft underline">
          ← volver al viaje
        </Link>
        <h1 className="mt-3 font-display text-3xl font-semibold">
          compartiendo ubicación
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {trip.origin} → {trip.destination}
        </p>

        <div className="mt-8 rounded-[10px] border border-line bg-white p-6">
          {isSharing ? (
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">compartiendo ubicación</p>
                <p className="text-[13px] text-ink-muted">
                  {geoNote ?? "mandamos tu posición cada 25 segundos mientras avanzás."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={stopSharing}
              >
                dejar de compartir
              </Button>
            </div>
          ) : geoState === "denied" ? (
            <div>
              <p className="text-sm font-medium text-danger">sin permiso de ubicación</p>
              <p className="mt-1 text-[13px] text-ink-soft">{geoMessage}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={startSharing}>
                reintentar
              </Button>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-ink">compartir mi ubicación</p>
              <p className="mt-1 text-[13px] text-ink-soft">
                el navegador te va a pedir permiso para usar el gps. solo mandamos puntos
                del recorrido, nunca tu dirección exacta.
              </p>
              {geoMessage && <p className="mt-2 text-[13px] text-danger">{geoMessage}</p>}
              <Button variant="dark" size="md" className="mt-4" onClick={startSharing}>
                empezar a compartir
              </Button>
            </div>
          )}
        </div>

        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-[17px] font-medium">recorrido</h2>
            {lastSent && (
              <p className="text-[13px] text-ink-muted">
                último envío {formatTime(lastSent.at.toISOString())}
              </p>
            )}
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">
            {track.length > 0
              ? `${track.length} ${track.length === 1 ? "punto" : "puntos"} compartidos.`
              : "cuando compartas tu posición vas a ver el recorrido acá."}
          </p>
          <LazyTripMap location={location} track={track} className="mt-3 h-80" />
        </section>

        {postLocation.isError && (
          <p className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
            no pudimos guardar tu posición: {postLocation.error.message}
          </p>
        )}
      </main>
    </div>
  );
}
