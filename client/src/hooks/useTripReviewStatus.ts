import { useMemo } from "react";
import type { TripDetail } from "../types/trip";
import type { UserRole } from "../types/user";

export type ReviewStatus = {
  /** se puede mostrar el form: viaje completado + empresa con carga viva + sin calificar */
  canReview: boolean;
  /** ya calificó al fletero en este viaje */
  reviewed: boolean;
};

export function useTripReviewStatus(
  trip: TripDetail | undefined,
  user: { id: string; role: UserRole } | null | undefined
): ReviewStatus {
  return useMemo(() => {
    if (!trip || !user || user.role !== "COMPANY") {
      return { canReview: false, reviewed: false };
    }

    // el backend exige carga no cancelada: si la única carga de la empresa está
    // cancelada, el form no se muestra (el server igual la rechazaría con 403).
    const hasCargo = trip.cargoItems.some(
      (item) => item.companyId === user.id && item.status !== "CANCELLED"
    );
    // la reseña no dice quién la escribió: el server avisa si fue quien mira
    const reviewed = trip.viewerReviewed;

    return {
      canReview: trip.status === "COMPLETED" && hasCargo && !reviewed,
      reviewed,
    };
  }, [trip, user]);
}
