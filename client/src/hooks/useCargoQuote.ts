import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/** lo que costaría la carga: la misma cuenta que cobra la reserva (lib/pricing.ts) */
export type CargoQuote = {
  volume: number;
  depositPercent: number;
  priceShare: number;
  depositAmount: number;
  balanceAmount: number;
};

const DEBOUNCE_MS = 400;

/**
 * 03§1.3: el resumen en vivo antes de «sumar carga». Los montos salen del
 * server (`GET /trips/:id/cargo-quote`), nunca de una cuenta del client. Se
 * pide con el volumen quieto 400 ms, y `volume` null (vacío o inválido) no
 * pide nada.
 */
export function useCargoQuote(tripId: string, volume: number | null) {
  const [debounced, setDebounced] = useState<number | null>(volume);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(volume), DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [volume]);

  const query = useQuery({
    queryKey: ["cargo-quote", tripId, debounced],
    queryFn: () =>
      api.get<CargoQuote>(
        `/trips/${encodeURIComponent(tripId)}/cargo-quote?volume=${debounced}`
      ),
    enabled: Boolean(tripId) && debounced !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });

  // mientras el volumen escrito no es el cotizado, no se muestra un monto viejo
  const current = volume !== null && query.data?.volume === volume ? query.data : null;
  return { quote: current, isError: query.isError && debounced === volume };
}
