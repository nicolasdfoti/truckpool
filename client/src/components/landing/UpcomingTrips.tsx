import { Link } from "react-router-dom";
import { useTrips } from "../../hooks/useTrips";
import { CapacityBar } from "../CapacityBar";
import { SkeletonBar } from "../Loading";
import { Section } from "./Section";
import { formatM3, formatPesos, formatTripDay, pricePerM3 } from "../../lib/format";

const SHOWN = 3;

/**
 * Los primeros viajes con lugar, de GET /trips (que ya trae sólo los abiertos
 * con fecha futura, ordenados por fecha). Si no hay o la API falla, la sección
 * no se muestra: la landing no depende de que haya viajes.
 */
export function UpcomingTrips() {
  const { data, isLoading, isError } = useTrips();
  const trips = (data ?? [])
    .filter((t) => t.capacityTotal - t.capacityUsed > 0)
    .slice(0, SHOWN);

  if (isError || (!isLoading && trips.length === 0)) return null;

  return (
    <Section
      id="proximas-salidas"
      title="Próximas salidas con lugar"
      lead="Viajes publicados por fleteros verificados. El precio es por m³ y lo ves antes de reservar."
      aside={
        <Link to="/viajes" className="font-medium text-brand underline">
          Ver todos los viajes
        </Link>
      }
    >
      <ul className="grid gap-3 lg:grid-cols-3 lg:gap-6">
        {isLoading
          ? Array.from({ length: SHOWN }, (_, i) => (
              <li key={i} className="rounded-xl border border-line bg-white p-6">
                <SkeletonBar className="h-5 w-2/3" />
                <SkeletonBar className="mt-3 h-4 w-1/2" />
                <SkeletonBar className="mt-6 h-4 w-full" />
              </li>
            ))
          : trips.map((trip) => {
              const free = trip.capacityTotal - trip.capacityUsed;
              return (
                <li key={trip.id}>
                  <Link
                    to={`/viajes/${trip.id}`}
                    className="block h-full rounded-xl border border-line bg-white p-6 transition-colors hover:border-brand"
                  >
                    <p className="font-display text-[19px] leading-tight font-semibold text-ink">
                      {trip.origin} → {trip.destination}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {formatTripDay(trip.date)}
                      {trip.departureTime && `, sale ${trip.departureTime}`}.{" "}
                      {trip.truckType} de {formatM3(trip.capacityTotal)} m³
                    </p>
                    <CapacityBar
                      capacityTotal={trip.capacityTotal}
                      capacityUsed={trip.capacityUsed}
                      className="mt-6 mb-3"
                    />
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="font-display text-[22px] font-semibold text-brand">
                        {formatM3(free)} m³ libres
                      </span>
                      <span className="font-semibold text-ink">
                        {formatPesos(pricePerM3(trip))} por m³
                      </span>
                    </p>
                    <p className="mt-4 border-t border-line pt-3 text-sm text-ink-soft">
                      {trip.carrierName}
                    </p>
                  </Link>
                </li>
              );
            })}
      </ul>
    </Section>
  );
}
