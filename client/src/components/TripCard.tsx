import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { StatusBadge } from "./StatusBadge";
import { TripFeatureBadge } from "./TripFeatureBadge";
import { ArrowRight, Clock, MapPin } from "./icons";
import { formatTripWhen } from "../lib/tripWhen";
import type { Trip } from "../types/trip";

type TripCardProps = {
  trip: Trip;
  showCarrier?: boolean;
  footer?: ReactNode;
  /**
   * "li" cuando la card es hija directa de una <ul> (listado de viajes).
   * "div" cuando la envuelve un <Link>: un <li> dentro de un <a> es html
   * inválido, y el link no debe tener otros links adentro.
   */
  as?: "li" | "div";
};

export function TripCard({
  trip,
  showCarrier = true,
  footer,
  as: Wrapper = "li",
}: TripCardProps) {
  return (
    <Wrapper className="flex flex-col rounded-[10px] border border-line bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[13px] text-ink-muted">
          {formatTripWhen(trip.date, trip.departureTime)}
          {trip.departureTime && (
            <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-ink-soft">
              <Clock size={12} aria-hidden />
              sale {trip.departureTime}
            </span>
          )}
        </span>
        <StatusBadge status={trip.status} />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <MapPin className="h-5 w-5 text-brand" aria-hidden />
        <span className="font-display text-lg font-medium">{trip.origin}</span>
        <ArrowRight className="h-5 w-5 text-ink-muted" aria-hidden />
        <span className="font-display text-lg font-medium">{trip.destination}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-soft">
        <span>{trip.truckType}</span>
        <span>
          {trip.capacityUsed.toFixed(1)} / {trip.capacityTotal.toFixed(1)} m³ ocupados
        </span>
        <span className="font-medium text-brand">
          {trip.price.toLocaleString("es-AR", {
            style: "currency",
            currency: "ARS",
          })}
        </span>
      </div>

      {trip.features.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {trip.features.map((feature) => (
            <TripFeatureBadge key={feature} feature={feature} />
          ))}
        </div>
      )}

      {showCarrier && (
        <Link
          to={`/fleteros/${trip.carrierId}`}
          className="mt-2 text-[13px] text-ink-muted hover:text-brand"
        >
          por {trip.carrierName}
        </Link>
      )}

      {/* undefined = botón default; null = sin footer. con ?? no alcanzaba
          porque null es nullish y caía siempre en el default (dejaba el link
          "ver y sumar carga" adentro de la card, inválido si la card ya es un
          link). */}
      {footer !== null && (
        <div className="mt-5">
          {footer === undefined ? (
            <Button asChild variant="dark" size="sm" className="w-full">
              <Link to={`/viajes/${trip.id}`}>ver y sumar carga</Link>
            </Button>
          ) : (
            footer
          )}
        </div>
      )}
    </Wrapper>
  );
}
