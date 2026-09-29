import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import { Truck } from "./icons";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Red de seguridad global: si un componente revienta (un bug de render, un
 * undefined de la API), antes el usuario se quedaba con una pantalla blanca
 * sin explicación. Acá se muestra qué pasó y cómo salir.
 *
 * Solo atrapa errores de render, no promesas rechazadas: para esas está el
 * `isError` de cada query de TanStack.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // en producción esto debería ir a Sentry o similar; por ahora queda en la
    // consola, que es lo que hay
    console.error("[TruckPool] la app se rompió:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-center font-sans text-ink">
        <span className="flex h-16 w-16 items-center justify-center rounded-[10px] bg-brand">
          <Truck className="h-9 w-9 text-accent-strong" aria-hidden />
        </span>

        <h1 className="mt-8 font-display text-2xl font-semibold">algo salió mal</h1>
        <p className="mt-3 max-w-md text-sm text-ink-soft">
          la app se rompió y no pudimos seguir. recargá la página y seguí donde estabas.
        </p>
        {import.meta.env.DEV && (
          <pre className="mt-6 max-w-lg overflow-x-auto rounded-md bg-white p-3 text-left text-xs text-danger">
            {error.message}
          </pre>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button
            variant="primary"
            size="md"
            onClick={() => this.setState({ error: null })}
          >
            reintentar
          </Button>
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              // full reload: si el error viene de un estado corrupto en memoria,
              // volver a renderizar el árbol no lo arregla
              window.location.href = "/";
            }}
          >
            volver al inicio
          </Button>
        </div>
      </div>
    );
  }
}
