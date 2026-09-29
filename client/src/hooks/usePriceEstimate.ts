import { useEffect, useState } from "react";
import { api } from "../api/client";

export type PriceEstimate = {
  truckType: string;
  rate: { baseFee: number; perKm: number };
  geocoded: boolean;
  distanceKm: number | null;
  suggestedPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
};

const DEBOUNCE_MS = 500;
const MIN_ADDRESS_LENGTH = 3;

type EstimateResult = { key: string; data: PriceEstimate };

/**
 * Precio sugerido para el viaje que el fletero está armando.
 *
 * Manda los strings de origen/destination tal cual: el server los geocodifica
 * con el mismo `geocode()` que ya cacheó cuando el front geocodificó cada campo
 * para mover el pin, así que esta llamada no gasta un request del rate limit de
 * Nominatim.
 *
 * El resultado se guarda claveado por la consulta, igual que `usePlaceField`: si
 * el campo de origen todavía dice "Rosario" y la respuesta es de "Córdoba", no
 * se muestra nada en vez de mostrar un precio del lugar anterior.
 *
 * `null` mientras no hay nada que estimar (faltan las puntas, son muy cortas, o
 * la request falla): el form usa eso para mostrar el input libre de precio.
 */
export function usePriceEstimate(origin: string, destination: string, truckType: string) {
  const from = origin.trim();
  const to = destination.trim();
  const ready = from.length >= MIN_ADDRESS_LENGTH && to.length >= MIN_ADDRESS_LENGTH;
  const key = `${from}|${to}|${truckType}`;
  const [result, setResult] = useState<EstimateResult | null>(null);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const timeout = setTimeout(() => {
      api
        .get<PriceEstimate>(
          `/trips/price-estimate?origin=${encodeURIComponent(from)}` +
            `&destination=${encodeURIComponent(to)}` +
            `&truckType=${encodeURIComponent(truckType)}`
        )
        .then(
          (data) => {
            if (alive) setResult({ key, data });
          },
          () => {
            // no se pudo estimar o el server no respondió: input libre
            if (alive) setResult(null);
          }
        );
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [from, to, truckType, ready, key]);

  const fresh = ready && result?.key === key;
  return { estimate: fresh ? result.data : null };
}
