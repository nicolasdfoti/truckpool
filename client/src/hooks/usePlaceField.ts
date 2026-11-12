import { useEffect, useRef, useState } from "react";
import { geocodePlace, type GeocodedPlace } from "./useTrips";

const DEBOUNCE_MS = 500;
const MIN_ADDRESS_LENGTH = 3;

type GeocodeResult = { address: string; place: GeocodedPlace | null };

/**
 * Geocodifica lo que el fletero escribe para origen y destino mientras escribe
 * (contra nuestro endpoint, que reusa lib/geocode.ts del server: el browser
 * nunca habla con Nominatim). El pin y el lugar en texto salen de la dirección
 * escrita: si el lugar no es el correcto, se corrige el texto.
 *
 * El pin no se mueve a mano: el server vuelve a geocodificar el texto al
 * publicar, así que un pin arrastrado se perdería sin avisar (L10 lo manda).
 *
 * El estado guarda el resultado *por dirección*: si el campo quedó en "Rosario"
 * y el resultado es de "Córdoba", no se muestra nada en vez de mostrar un pin
 * del lugar anterior.
 */
export function usePlaceField(value: string) {
  const address = value.trim();
  const [result, setResult] = useState<GeocodeResult | null>(null);
  // id de la última consulta lanzada: una respuesta vieja no pisa una más nueva
  const requestId = useRef(0);

  const tooShort = address.length < MIN_ADDRESS_LENGTH;
  const resolvedFor = result?.address === address ? result.address : null;
  const place = resolvedFor ? (result?.place ?? null) : null;

  useEffect(() => {
    if (tooShort || resolvedFor === address) return;
    const id = ++requestId.current;
    const timeout = setTimeout(() => {
      geocodePlace(address).then(
        (found) => {
          if (id !== requestId.current) return;
          setResult({ address, place: found });
        },
        () => {
          if (id !== requestId.current) return;
          // null = "no encontramos esa dirección": no es lo mismo que un fallo
          setResult({ address, place: null });
        }
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [address, tooShort, resolvedFor]);

  return {
    point: place ? { lat: place.lat, lng: place.lng } : null,
    /** "Córdoba, Córdoba, Argentina", o null si el server no lo informó */
    label: place?.label ?? null,
    /** true mientras se busca la dirección escrita */
    resolving: !tooShort && resolvedFor === null,
    resolvedFor,
    /** se escribió algo y no lo encontramos */
    notFound: !tooShort && resolvedFor === address && result?.place === null,
  };
}
