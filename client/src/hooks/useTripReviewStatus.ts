import { useMemo } from "react";
import type { TripDetail } from "../types/trip";

export type ReviewStatus = {
  /** el usuario logueado es el fletero o tiene carga en este viaje */
  participated: boolean;
  /** ya calificación a alguien en este viaje */
  reviewed: boolean;
  /** se puede mostrar el form:trip completado + participó + no calificó */
  canReview: boolean;
  /** a quién le corresponde la calificación si es única (sin ambigüedad) */
  targetUserId: string | null;
  /** empresas con carga en el viaje, para cuando hay más de una y hay que elegir */
  companyOptions: { id: string; name: string }[];
};

export function useTripReviewStatus(
  trip: TripDetail | undefined,
  userId: string | undefined
): ReviewStatus {
  return useMemo(() => {
    const companies = new Map<string, string>();
    for (const item of trip?.cargoItems ?? []) {
      companies.set(item.companyId, item.companyName || item.companyId);
    }
    const companyOptions = [...companies].map(([id, name]) => ({ id, name }));

    if (!trip || !userId) {
      return {
        participated: false,
        reviewed: false,
        canReview: false,
        targetUserId: null,
        companyOptions,
      };
    }

    const isCarrier = trip.carrierId === userId;
    const isCompany = companies.has(userId);
    const participated = isCarrier || isCompany;
    const reviewed = trip.reviews.some((review) => review.fromUserId === userId);

    let targetUserId: string | null = null;
    if (isCarrier && companyOptions.length === 1) targetUserId = companyOptions[0].id;
    if (isCompany) targetUserId = trip.carrierId;

    return {
      participated,
      reviewed,
      canReview: trip.status === "COMPLETED" && participated && !reviewed,
      targetUserId,
      companyOptions,
    };
  }, [trip, userId]);
}
