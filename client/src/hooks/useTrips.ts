import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Trip, TripFeature } from "../types/trip";

/** "lat,lng,radioKm" — el formato que espera GET /api/trips */
export type ProximityFilter = {
  lat: number;
  lng: number;
  radiusKm: number;
};

export type TripFilters = {
  origin?: string;
  destination?: string;
  dateFrom?: string;
  dateTo?: string;
  features?: TripFeature[];
  nearOrigin?: ProximityFilter;
  nearDestination?: ProximityFilter;
};

export function toProximityParam(filter: ProximityFilter): string {
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return `${round(filter.lat)},${round(filter.lng)},${round(filter.radiusKm)}`;
}

export const EMPTY_TRIP_FILTERS: TripFilters = {};

function buildQueryString(filters: TripFilters) {
  const params = new URLSearchParams();
  if (filters.origin) params.set("origin", filters.origin);
  if (filters.destination) params.set("destination", filters.destination);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  for (const feature of filters.features ?? []) params.append("features", feature);
  if (filters.nearOrigin) params.set("nearOrigin", toProximityParam(filters.nearOrigin));
  if (filters.nearDestination)
    params.set("nearDestination", toProximityParam(filters.nearDestination));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function geocodeAddress(address: string) {
  return api
    .get<{ address: string; lat: number; lng: number }>(
      `/trips/geocode?address=${encodeURIComponent(address)}`
    )
    .then((d) => ({ lat: d.lat, lng: d.lng }));
}

export function useTrips(filters: TripFilters = EMPTY_TRIP_FILTERS) {
  return useQuery({
    queryKey: ["trips", filters],
    queryFn: () => api.get<Trip[]>(`/trips${buildQueryString(filters)}`),
  });
}
