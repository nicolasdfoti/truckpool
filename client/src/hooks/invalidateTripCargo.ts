import type { QueryClient } from "@tanstack/react-query";

/**
 * Lo que cambia cuando cambian las cargas de un viaje o su estado: reservar,
 * retirar, confirmar, salir (D3 cancela las que no se confirmaron) y cancelar
 * el viaje (D6). Un solo lugar para que ninguna mutación deje paradas o
 * recorrido viejos en pantalla (RD4).
 */
export function invalidateTripCargo(queryClient: QueryClient, tripId: string) {
  // el viaje (cargas, ocupación, estado) y el listado
  queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
  queryClient.invalidateQueries({ queryKey: ["trips"] });
  // las paradas y el recorrido que salen de las cargas activas
  queryClient.invalidateQueries({ queryKey: ["tripStops", tripId] });
  queryClient.invalidateQueries({ queryKey: ["trip-route", tripId] });
  queryClient.invalidateQueries({ queryKey: ["trip-route-geometry", tripId] });
  // la cotización de retiro depende del estado de la carga y del viaje
  queryClient.invalidateQueries({ queryKey: ["cargo-cancellation-quote", tripId] });
  // «mis cargas» y «mis viajes» del perfil
  queryClient.invalidateQueries({ queryKey: ["me", "cargo-items"] });
  queryClient.invalidateQueries({ queryKey: ["me", "trips"] });
}
