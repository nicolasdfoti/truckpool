import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { CheckCircle, XCircle } from "../components/icons";

export default function PaymentReturn() {
  const [params] = useSearchParams();
  const tripId = params.get("tripId");
  const status = params.get("status");
  const isBalance = params.get("type") === "BALANCE";
  const approved = status === "approved";
  const rejected = status === "rejected";
  const tripUrl = tripId ? `/viajes/${tripId}` : "/viajes";

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div className="rounded-[10px] border border-line bg-white p-8 text-center">
          {approved ? (
            <>
              <CheckCircle className="mx-auto h-12 w-12 text-success-deep" aria-hidden />
              <h1 className="mt-4 font-display text-2xl font-semibold">pago recibido</h1>
              <p className="mt-2 text-sm text-ink-soft">
                {isBalance
                  ? "el saldo quedó abonado. el transportista ya lo ve al instante."
                  : "ya podés confirmar la carga: el transportista la ve al instante."}
              </p>
            </>
          ) : rejected ? (
            <>
              <XCircle className="mx-auto h-12 w-12 text-danger" aria-hidden />
              <h1 className="mt-4 font-display text-2xl font-semibold">pago rechazado</h1>
              <p className="mt-2 text-sm text-ink-soft">
                no se cobró nada. podés intentar de nuevo con otra tarjeta.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold">pago en proceso</h1>
              <p className="mt-2 text-sm text-ink-soft">
                estamos esperando la confirmación de Mercado Pago. en un momento te
                avisamos.
              </p>
            </>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button asChild variant="primary" size="sm">
              <Link to={tripUrl}>volver al viaje</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/viajes">ver otros viajes</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
