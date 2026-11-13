import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { CapacityBar } from "./CapacityBar";
import { StatusBadge } from "./StatusBadge";
import { TripFeatureBadge } from "./TripFeatureBadge";
import { formatM3, formatPesos, formatTripDay, pricePerM3 } from "../lib/format";
import type { Trip } from "../types/trip";

type TripCardProps = {
  trip: Trip;
  showCarrier?: boolean;
  /**
   * undefined: toda la card lleva al viaje (link estirado sobre el título).
   * null: sin link, porque ya la envuelve uno (perfil). Un nodo: se muestra al pie.
   */
  footer?: ReactNode;
  /**
   * "li" cuando la card es hija directa de una <ul> (listado de viajes).
   * "div" cuando la envuelve un <Link>: un <li> dentro de un <a> es html
   * inválido, y el link no debe tener otros links adentro.
   */
  as?: "li" | "div";
};

/**
 * Un viaje en un listado (rediseño A): la ruta, cuándo sale, la caja en chico y
 * lo que le importa a la empresa, los m³ libres y el precio por m³.
 */
export function TripCard({
  trip,
  showCarrier = true,
  footer,
  as: Wrapper = "li",
}: TripCardProps) {
  const free = Math.max(0, trip.capacityTotal - trip.capacityUsed);
  const linked = footer === undefined;
  const route = (
    <>
      {trip.origin} <span aria-hidden="true">→</span>
      <span className="sr-only">a</span> {trip.destination}
    </>
  );

  return (
    <Wrapper
      className={`relative flex flex-col rounded-xl border border-line bg-white p-5 transition-colors sm:p-6 ${
        linked ? "hover:border-brand" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-[19px] leading-tight font-semibold text-ink">
          {linked ? (
            <Link
              to={`/viajes/${trip.id}`}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent-strong"
            >
              {route}
            </Link>
          ) : (
            route
          )}
        </h3>
        <StatusBadge status={trip.status} />
      </div>
      <p className="mt-1 mb-5 text-sm text-ink-soft">
        {formatTripDay(trip.date)}
        {trip.departureTime && `, sale ${trip.departureTime}`}. {trip.truckType} de{" "}
        {formatM3(trip.capacityTotal)} m³
      </p>

      <CapacityBar
        capacityTotal={trip.capacityTotal}
        capacityUsed={trip.capacityUsed}
        className="mt-auto mb-3"
      />
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-display text-[22px] font-semibold text-brand">
          {free > 0 ? `${formatM3(free)} m³ libres` : "sin lugar"}
        </span>
        <span className="font-semibold text-ink">
          {formatPesos(pricePerM3(trip))} por m³
        </span>
      </p>

      {trip.features.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {trip.features.map((feature) => (
            <TripFeatureBadge key={feature} feature={feature} />
          ))}
        </div>
      )}

      {showCarrier && (
        <p className="mt-4 border-t border-line pt-3 text-sm text-ink-soft">
          <Link
            to={`/fleteros/${trip.carrierId}`}
            className="relative z-[1] hover:text-brand hover:underline"
          >
            {trip.carrierName}
          </Link>
        </p>
      )}

      {footer != null && <div className="mt-5">{footer}</div>}
    </Wrapper>
  );
}
