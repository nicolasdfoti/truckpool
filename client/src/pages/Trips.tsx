import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { TripCard } from "../components/TripCard";
import { Search, Truck } from "../components/icons";
import { FEATURE_META } from "../lib/tripFeatures";
import { EMPTY_TRIP_FILTERS, geocodeAddress, useTrips } from "../hooks/useTrips";
import type { TripFilters } from "../hooks/useTrips";
import { useAuth } from "../hooks/useAuth";
import { TRIP_FEATURES } from "../types/trip";
import { SkeletonList } from "../components/Loading";
import type { TripFeature } from "../types/trip";

const inputClass = "input mt-1.5";
const labelClass = "text-sm font-medium text-ink";

const TEXT_DEBOUNCE_MS = 300;

/**
 * Los filtros que vienen en la URL (el buscador de la landing manda
 * `?origen=&destino=&desde=`). Se leen una vez, al entrar.
 */
function filtersFromUrl(params: URLSearchParams): TripFilters {
  const origin = params.get("origen")?.trim() || undefined;
  const destination = params.get("destino")?.trim() || undefined;
  const desde = params.get("desde") ?? "";
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : undefined;
  if (!origin && !destination && !dateFrom) return EMPTY_TRIP_FILTERS;
  return { origin, destination, dateFrom };
}

export default function Trips() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<TripFilters>(() => filtersFromUrl(searchParams));
  const [originInput, setOriginInput] = useState(() => filters.origin ?? "");
  const [destinationInput, setDestinationInput] = useState(
    () => filters.destination ?? ""
  );
  // búsqueda por ruta: dos casillas opcionales, cada una con su radio
  const [routeSearch, setRouteSearch] = useState(false);
  const [nearOriginAddress, setNearOriginAddress] = useState("");
  const [nearDestinationAddress, setNearDestinationAddress] = useState("");
  const [radiusKm, setRadiusKm] = useState(50);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const { data: trips, isLoading, isFetching, isError } = useTrips(filters);
  const { user } = useAuth();

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFilters((current) => ({
        ...current,
        origin: originInput.trim() || undefined,
        destination: destinationInput.trim() || undefined,
      }));
    }, TEXT_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [originInput, destinationInput]);

  // y al revés: origen, destino y fecha quedan en la URL, para compartir la
  // búsqueda o volver a ella. replace, para no llenar el historial; sólo se
  // escribe si cambió, así no hay un ida y vuelta con el router.
  const urlQuery = searchParams.toString();
  const filtersQuery = new URLSearchParams(
    Object.entries({
      origen: filters.origin,
      destino: filters.destination,
      desde: filters.dateFrom,
    }).filter((entry): entry is [string, string] => Boolean(entry[1]))
  ).toString();
  useEffect(() => {
    if (filtersQuery !== urlQuery) setSearchParams(filtersQuery, { replace: true });
  }, [filtersQuery, urlQuery, setSearchParams]);

  const hasFilters = Boolean(
    filters.origin ||
    filters.destination ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.nearOrigin ||
    filters.nearDestination ||
    (filters.features && filters.features.length > 0)
  );

  /**
   * Geocodifica las direcciones tipeadas contra nuestro propio endpoint (que
   * reusa lib/geocode.ts) y recién después manda nearOrigin/nearDestination.
   * Así el rate limit de Nominatim lo respetamos desde el server y no desde
   * cada browser. Si una dirección no se resuelve, se avisa y no se filtra.
   */
  async function applyRouteSearch() {
    const origin = nearOriginAddress.trim();
    const destination = nearDestinationAddress.trim();
    if (!origin && !destination) {
      setRouteError("escribí al menos un punto de la ruta para buscar por cercanía.");
      return;
    }

    setResolving(true);
    setRouteError(null);
    try {
      const [originPoint, destinationPoint] = await Promise.all([
        origin ? geocodeAddress(origin) : Promise.resolve(undefined),
        destination ? geocodeAddress(destination) : Promise.resolve(undefined),
      ]);
      setFilters((current) => ({
        ...current,
        nearOrigin: originPoint ? { ...originPoint, radiusKm } : undefined,
        nearDestination: destinationPoint ? { ...destinationPoint, radiusKm } : undefined,
      }));
    } catch (err) {
      setFilters((current) => ({
        ...current,
        nearOrigin: undefined,
        nearDestination: undefined,
      }));
      setRouteError(
        err instanceof Error ? err.message : "no pudimos resolver esa dirección."
      );
    } finally {
      setResolving(false);
    }
  }

  function disableRouteSearch() {
    setRouteSearch(false);
    setRouteError(null);
    setFilters((current) => ({
      ...current,
      nearOrigin: undefined,
      nearDestination: undefined,
    }));
  }

  function toggleFeature(feature: TripFeature) {
    setFilters((current) => {
      const active = current.features ?? [];
      return {
        ...current,
        features: active.includes(feature)
          ? active.filter((item) => item !== feature)
          : [...active, feature],
      };
    });
  }

  function clearFilters() {
    setOriginInput("");
    setDestinationInput("");
    setNearOriginAddress("");
    setNearDestinationAddress("");
    setRouteError(null);
    setFilters(EMPTY_TRIP_FILTERS);
  }

  const hasResults = Boolean(trips && trips.length > 0);
  const showEmptyDatabase = Boolean(trips && trips.length === 0 && !hasFilters);
  const showNoMatches = Boolean(trips && trips.length === 0 && hasFilters);

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-[clamp(28px,3.4vw,36px)] leading-tight font-semibold">
              Viajes con lugar
            </h1>
            <p className="mt-2 text-[17px] text-ink-soft">
              Sumá tu carga al viaje que te quede de paso. El precio es por m³.
            </p>
          </div>
          {user?.role === "CARRIER" && (
            <Button asChild variant="dark" size="sm">
              <Link to="/viajes/nuevo">Publicar un viaje</Link>
            </Button>
          )}
        </div>

        <section
          className="mt-8 rounded-xl border border-line bg-white p-4 sm:p-6"
          aria-label="filtros de viajes"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelClass} htmlFor="filter-origin">
                Origen
              </label>
              <input
                id="filter-origin"
                value={originInput}
                onChange={(e) => setOriginInput(e.target.value)}
                placeholder="Ej.: Córdoba"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="filter-destination">
                Destino
              </label>
              <input
                id="filter-destination"
                value={destinationInput}
                onChange={(e) => setDestinationInput(e.target.value)}
                placeholder="Ej.: Rosario"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="filter-date-from">
                Desde el
              </label>
              <input
                id="filter-date-from"
                type="date"
                value={filters.dateFrom ?? ""}
                onChange={(e) =>
                  setFilters((current) => ({
                    ...current,
                    dateFrom: e.target.value || undefined,
                  }))
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="filter-date-to">
                Hasta el
              </label>
              <input
                id="filter-date-to"
                type="date"
                value={filters.dateTo ?? ""}
                onChange={(e) =>
                  setFilters((current) => ({
                    ...current,
                    dateTo: e.target.value || undefined,
                  }))
                }
                className={inputClass}
              />
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className={labelClass}>Servicios y extras</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {TRIP_FEATURES.map((feature) => {
                const { label, Icon } = FEATURE_META[feature];
                const active = filters.features?.includes(feature) ?? false;
                return (
                  <label
                    key={feature}
                    className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-strong ${
                      active
                        ? "border-brand bg-brand-tint font-medium text-brand"
                        : "border-line bg-white text-ink-soft hover:border-brand"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleFeature(feature)}
                      className="sr-only"
                    />
                    <Icon size={16} aria-hidden />
                    {label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-sm text-ink-soft" aria-live="polite">
              {isFetching && hasFilters
                ? "buscando…"
                : hasFilters && trips
                  ? `${trips.length} ${trips.length === 1 ? "viaje coincide" : "viajes coinciden"} con esos filtros`
                  : "los filtros se combinan entre sí."}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {!routeSearch && (
                <button
                  type="button"
                  onClick={() => setRouteSearch(true)}
                  className="text-sm font-medium text-brand underline"
                >
                  Buscar cerca de una ruta
                </button>
              )}
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
            </div>
          </div>

          {routeSearch && (
            <div className="mt-4 rounded-lg bg-soft p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium text-ink">Buscar cerca de una ruta</p>
                <Button variant="ghost" size="sm" onClick={disableRouteSearch}>
                  Cerrar
                </Button>
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                Escribí una ciudad, un barrio o una dirección. Solo aparecen los viajes
                cuyo origen o destino caen dentro del radio.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className={labelClass} htmlFor="near-origin">
                    Salida cerca de
                  </label>
                  <input
                    id="near-origin"
                    value={nearOriginAddress}
                    onChange={(e) => setNearOriginAddress(e.target.value)}
                    placeholder="Ej.: Rosario, Santa Fe"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="near-destination">
                    Llegada cerca de
                  </label>
                  <input
                    id="near-destination"
                    value={nearDestinationAddress}
                    onChange={(e) => setNearDestinationAddress(e.target.value)}
                    placeholder="Ej.: Córdoba"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="near-radius">
                    Radio (km)
                  </label>
                  <input
                    id="near-radius"
                    type="number"
                    min={1}
                    max={500}
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(Number(e.target.value) || 1)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  variant="dark"
                  size="sm"
                  disabled={resolving}
                  onClick={applyRouteSearch}
                >
                  {resolving ? "buscando dirección…" : "Buscar por cercanía"}
                </Button>
                {filters.nearOrigin && (
                  <span className="text-sm text-ink-soft">
                    filtrando por radio de {radiusKm} km
                  </span>
                )}
              </div>

              {routeError && (
                <p className="mt-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
                  {routeError}
                </p>
              )}
            </div>
          )}
        </section>

        {isLoading && <SkeletonList count={6} className="mt-8" />}

        {isError && (
          <p className="mt-10 rounded-lg border border-line bg-white p-4 text-sm text-danger">
            no pudimos cargar los viajes. probá de nuevo en un rato.
          </p>
        )}

        {showEmptyDatabase && (
          <div className="mt-16 flex flex-col items-center text-center">
            <Truck className="h-10 w-10 text-ink-muted" aria-hidden />
            <p className="mt-4 font-display text-lg font-semibold">
              Todavía no hay viajes publicados.
            </p>
            {user?.role === "CARRIER" ? (
              <Button asChild variant="dark" size="sm" className="mt-4">
                <Link to="/viajes/nuevo">Ser el primero en publicar</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link to="/ingresar?tab=register&role=carrier">
                  Registrate como fletero
                </Link>
              </Button>
            )}
          </div>
        )}

        {showNoMatches && (
          <div className="mt-16 flex flex-col items-center text-center">
            <Search className="h-10 w-10 text-ink-muted" aria-hidden />
            <p className="mt-4 font-display text-lg font-semibold">
              No encontramos viajes con esos filtros.
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {filters.nearOrigin || filters.nearDestination
                ? "no hay viajes dentro de ese radio. probá con un radio más grande o revisá los puntos de la ruta."
                : "probá con menos filtros o mirá todos los viajes."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            </div>
          </div>
        )}

        {trips && trips.length > 0 && (
          <ul
            className="mt-8 grid gap-4 transition-opacity md:grid-cols-2 lg:grid-cols-3"
            aria-busy={isFetching}
          >
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </ul>
        )}

        {!user && hasResults && (
          <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-xl bg-brand p-6 text-white sm:flex-row sm:items-center">
            <div>
              <p className="font-display text-lg font-semibold">
                ¿Tenés un camión que sale con lugar?
              </p>
              <p className="text-brand-tint">
                Publicá tu viaje y dejá que la carga venga a vos.
              </p>
            </div>
            <Button asChild variant="outline-light" size="sm" className="border-white">
              <Link to="/ingresar?tab=register&role=carrier">
                Crear cuenta de fletero
              </Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
