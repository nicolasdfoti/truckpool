import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Truck } from "../components/icons";

/**
 * 404 con los mismos tokens que el resto del sitio. Antes, una URL mal escrita
 * caía en la pantalla en blanco por defecto de React Router.
 *
 * Route element={<NotFound />} /> es el catch-all del router: matchea cualquier
 * path, así que tiene que ser la última ruta.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col bg-canvas font-sans text-ink">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-20 text-center sm:px-6">
        <span className="flex h-16 w-16 items-center justify-center rounded-[10px] bg-brand">
          <Truck className="h-9 w-9 text-accent-strong" aria-hidden />
        </span>

        <p className="mt-8 font-display text-6xl font-semibold tracking-tight text-brand">
          404
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold">
          esta página no existe
        </h1>
        <p className="mt-3 max-w-md text-sm text-ink-soft">
          el link puede estar mal escrito o el viaje que buscabas ya no está disponible.
          probá desde la ventana de viajes.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild variant="primary" size="md">
            <Link to="/">ir al inicio</Link>
          </Button>
          <Button asChild variant="outline" size="md">
            <Link to="/viajes">ver viajes disponibles</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
