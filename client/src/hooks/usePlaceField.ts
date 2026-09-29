import { useEffect, useRef, useState } from "react";
import { geocodeAddress } from "./useTrips";
import type { LatLng } from "../lib/geo";

const DEBOUNCE_MS = 500;
const MIN_ADDRESS_LENGTH = 3;

type GeocodeResult = { address: string; point: LatLng | null };
type HandPlacement = { address: string; point: LatLng };

/**
 * Geocodifica lo que el fletero escribe para origen y destino mientras escribe
 * (contra nuestro endpoint, que reusa lib/geocode.ts del server: el browser
 * nunca habla con Nominatim). El pin se mueve solo; si el geocode no cayó donde
 * debía, el fletero lo corrige moviéndolo y `movedByHand` evita que el próximo
 * debounce le pise el ajuste.
 *
 * El estado guarda el resultado *por dirección*: si el campo quedó en "Rosario"
 * y el resultado es de "Córdoba", no se muestra nada en vez de mostrar un pin
 * del lugar anterior.
 */
export function usePlaceField(value: string) {
  const address = value.trim();
  const [result, setResult] = useState<GeocodeResult | null>(null);
  const [hand, setHand] = useState<HandPlacement | null>(null);
  // id de la última consulta lanzada: una respuesta vieja no pisa una más nueva
  const requestId = useRef(0);

  const tooShort = address.length < MIN_ADDRESS_LENGTH;
  const resolvedFor = result?.address === address ? result.address : null;
  const point =
    hand?.address === address ? hand.point : resolvedFor ? (result?.point ?? null) : null;

  useEffect(() => {
    if (tooShort || resolvedFor === address) return;
    const id = ++requestId.current;
    const timeout = setTimeout(() => {
      geocodeAddress(address).then(
        (found) => {
          if (id !== requestId.current) return;
          setResult({ address, point: found });
        },
        () => {
          if (id !== requestId.current) return;
          // null = "no encontramos esa dirección": no es lo mismo que un fallo
          setResult({ address, point: null });
        }
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [address, tooShort, resolvedFor]);

  /** el fletero movió el pin: el punto pasa a ser suyo */
  function setPointByHand(next: LatLng) {
    setHand({ address, point: next });
  }

  return {
    point,
    /** true mientras se busca la dirección escrita */
    resolving: !tooShort && resolvedFor === null,
    resolvedFor,
    /** se escribió algo y no lo encontramos */
    notFound: !tooShort && resolvedFor === address && result?.point === null,
    movedByHand: hand?.address === address,
    setPointByHand,
  };
}
