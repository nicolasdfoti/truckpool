import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

const inputClass =
  "mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand";

const TEXT_DEBOUNCE_MS = 300;

export default function Trips() {
  const [filters, setFilters] = useState<TripFilters>(EMPTY_TRIP_FILTERS);
  const [originInput, setOriginInput] = useState("");
  const [destinationInput, setDestinationInput] = useState("");
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
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold">Ventana de viajes</h1>
            <p className="mt-1 text-sm text-ink-soft">
              viajes abiertos: sumá tu carga al que te quede de paso.
            </p>
          </div>
          {user?.role === "CARRIER" && (
            <Button asChild variant="primary" size="sm">
              <Link to="/viajes/nuevo">publicar un viaje</Link>
            </Button>
          )}
        </div>

        <section
          className="mt-8 rounded-[10px] border border-line bg-white p-6"
          aria-label="filtros de viajes"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="text-[13px] text-ink-soft" htmlFor="filter-origin">
                origen
              </label>
              <input
                id="filter-origin"
                value={originInput}
                onChange={(e) => setOriginInput(e.target.value)}
                placeholder="ej: Córdoba"
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[13px] text-ink-soft" htmlFor="filter-destination">
                destino
              </label>
              <input
                id="filter-destination"
                value={destinationInput}
                onChange={(e) => setDestinationInput(e.target.value)}
                placeholder="ej: Rosario"
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-[13px] text-ink-soft" htmlFor="filter-date-from">
                desde
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
              <label className="text-[13px] text-ink-soft" htmlFor="filter-date-to">
                hasta
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

          <div className="mt-4">
            <span className="text-[13px] text-ink-soft">servicios y extras</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TRIP_FEATURES.map((feature) => {
                const { label, Icon } = FEATURE_META[feature];
                const active = filters.features?.includes(feature) ?? false;
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
                    <Icon size={16} aria-hidden className={active ? "text-brand" : ""} />
                    {label}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[13px] text-ink-muted">
              {isFetching && hasFilters
                ? "buscando…"
                : hasFilters && trips
                  ? `${trips.length} ${trips.length === 1 ? "viaje coincide" : "viajes coinciden"} con esos filtros`
                  : "los filtros se combinan entre sí."}
            </p>
            {hasFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                limpiar filtros
              </Button>
            )}
          </div>
        </section>

        {isLoading && <SkeletonList count={6} className="mt-8" />}

        {isError && (
          <p className="mt-10 rounded-md border border-line bg-white p-4 text-sm text-danger">
            no pudimos cargar los viajes. probá de nuevo en un rato.
          </p>
        )}

        {showEmptyDatabase && (
          <div className="mt-16 flex flex-col items-center text-center">
            <Truck className="h-10 w-10 text-ink-muted" aria-hidden />
            <p className="mt-4 text-sm text-ink-soft">
              todavía no hay viajes publicados.
            </p>
            {user?.role === "CARRIER" ? (
              <Button asChild variant="primary" size="sm" className="mt-4">
                <Link to="/viajes/nuevo">ser el primero en publicar</Link>
              </Button>
            ) : (
              <Button asChild variant="primary" size="sm" className="mt-4">
                <Link to="/ingresar?tab=register&role=carrier">
                  registrate como transportista
                </Link>
              </Button>
            )}
          </div>
        )}

        <div className="mt-6 border-t border-line pt-6">
          {!routeSearch ? (
            <button
              type="button"
              onClick={() => setRouteSearch(true)}
              className="text-[13px] text-brand underline"
            >
              buscar cerca de una ruta
            </button>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-4">
                <p className="text-[13px] font-medium text-ink">
                  buscar cerca de una ruta
                </p>
                <Button variant="outline" size="sm" onClick={disableRouteSearch}>
                  cerrar
                </Button>
              </div>
              <p className="mt-1 text-[13px] text-ink-muted">
                escribí una ciudad, un barrio o una dirección. solo aparecen los viajes
                cuyo origen o destino caen dentro del radio.
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="text-[13px] text-ink-soft" htmlFor="near-origin">
                    salida cerca de
                  </label>
                  <input
                    id="near-origin"
                    value={nearOriginAddress}
                    onChange={(e) => setNearOriginAddress(e.target.value)}
                    placeholder="ej: Rosario, Santa Fe"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-[13px] text-ink-soft" htmlFor="near-destination">
                    llegada cerca de
                  </label>
                  <input
                    id="near-destination"
                    value={nearDestinationAddress}
                    onChange={(e) => setNearDestinationAddress(e.target.value)}
                    placeholder="ej: Córdoba"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-[13px] text-ink-soft" htmlFor="near-radius">
                    radio (km)
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

              <div className="mt-4 flex items-center gap-3">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={resolving}
                  onClick={applyRouteSearch}
                >
                  {resolving ? "buscando dirección…" : "buscar por cercanía"}
                </Button>
                {filters.nearOrigin && (
                  <span className="text-[13px] text-ink-muted">
                    filtrando por radio de {radiusKm} km
                  </span>
                )}
              </div>

              {routeError && (
                <p className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
                  {routeError}
                </p>
              )}
            </div>
          )}
        </div>

        {showNoMatches && (
          <div className="mt-16 flex flex-col items-center text-center">
            <Search className="h-10 w-10 text-ink-muted" aria-hidden />
            <p className="mt-4 text-sm text-ink-soft">
              no encontramos viajes con esos filtros.
            </p>
            <p className="mt-1 text-[13px] text-ink-muted">
              {filters.nearOrigin || filters.nearDestination
                ? "no hay viajes dentro de ese radio. probá con un radio más grande o revisá los puntos de la ruta."
                : "probá con menos filtros o mirá la ventana completa."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={clearFilters}>
                limpiar filtros
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/viajes">ver todos los viajes</Link>
              </Button>
            </div>
          </div>
        )}

        {trips && trips.length > 0 && (
          <ul
            className="mt-8 grid gap-4 transition-opacity md:grid-cols-2"
            aria-busy={isFetching}
          >
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </ul>
        )}

        {!user && hasResults && (
          <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-[10px] border border-line bg-white p-6 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <Search className="h-6 w-6 text-ink-muted" aria-hidden />
              <div>
                <p className="font-display text-base font-medium">
                  ¿no encontrás lo que buscás?
                </p>
                <p className="text-sm text-ink-soft">
                  publicá tu propio viaje y dejá que la carga venga a vos.
                </p>
              </div>
            </div>
            <Button asChild variant="primary" size="sm">
              <Link to="/ingresar?tab=register&role=carrier">
                crear cuenta de fletero
              </Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
