import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { CheckCircle, Clock, XCircle } from "../components/icons";
import { useAuth } from "../hooks/useAuth";
import { usePaymentStatus } from "../hooks/usePaymentStatus";
import { useCreatePaymentPreference } from "../hooks/useCreatePaymentPreference";
import { readLastPayment, type LastPayment } from "../lib/lastPayment";
import { formatInstant } from "../lib/tripWhen";

function currency(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

/**
 * El pago que se está mirando: el del back_url de MP (tripId, cargoItemId,
 * type) o, si se entra a mano sin parámetros, el último que se mandó a MP desde
 * este navegador. El `?status` de MP no se usa: el estado sale del server.
 */
function usePaymentTarget(): LastPayment | null {
  const [params] = useSearchParams();
  const tripId = params.get("tripId");
  const cargoItemId = params.get("cargoItemId");
  const type = params.get("type") === "BALANCE" ? "BALANCE" : "DEPOSIT";
  return useMemo(() => {
    if (tripId && cargoItemId) return { tripId, cargoItemId, type };
    return readLastPayment();
  }, [tripId, cargoItemId, type]);
}

function Card({
  icon,
  title,
  children,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div
          className="rounded-[10px] border border-line bg-white p-8 text-center"
          aria-live="polite"
        >
          {icon}
          <h1 className="mt-4 font-display text-2xl font-semibold">{title}</h1>
          <div className="mt-2 space-y-2 text-sm text-ink-soft">{children}</div>
          <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
        </div>
      </main>
    </div>
  );
}

/** U16 / 03§1.1: el retorno de Mercado Pago con el estado real del pago */
export default function PaymentReturn() {
  const { user, isLoading: authLoading } = useAuth();
  const target = usePaymentTarget();
  const { trip, item, payment, timedOut, isError } = usePaymentStatus(
    user ? target : null
  );
  const retry = useCreatePaymentPreference(target?.tripId ?? "");
  const tripUrl = target ? `/viajes/${target.tripId}` : "/viajes";
  const isBalance = target?.type === "BALANCE";

  const backToTrip = (label: string, variant: "primary" | "outline" = "primary") => (
    <Button asChild variant={variant} size="sm">
      <Link to={tripUrl}>{label}</Link>
    </Button>
  );

  if (!target) {
    return (
      <Card
        title="no encontramos el pago"
        actions={
          <>
            <Button asChild variant="primary" size="sm">
              <Link to="/perfil">ver mis cargas</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/viajes">ver viajes</Link>
            </Button>
          </>
        }
      >
        <p>
          no sabemos qué pago estás mirando. el estado de cada carga está en «mis cargas»
          y en el detalle del viaje.
        </p>
      </Card>
    );
  }

  // mientras se lee la sesión, sigue «verificando» (más abajo)
  if (!user && !authLoading) {
    return (
      <Card
        title="ingresá para ver tu pago"
        actions={
          <Button asChild variant="primary" size="sm">
            <Link to="/ingresar">ingresar</Link>
          </Button>
        }
      >
        <p>
          el estado del pago se consulta con tu cuenta. ingresá y volvé a esta página, o
          mirá la carga en el detalle del viaje.
        </p>
      </Card>
    );
  }

  // la carga no es de quien mira, o el viaje no se pudo leer
  if ((trip && !item) || (isError && timedOut)) {
    return (
      <Card
        title="no pudimos ver este pago"
        actions={
          <>
            {backToTrip("volver al viaje")}
            <Button asChild variant="outline" size="sm">
              <Link to="/perfil">ver mis cargas</Link>
            </Button>
          </>
        }
      >
        <p>revisá el estado de tu carga en el detalle del viaje o en «mis cargas».</p>
      </Card>
    );
  }

  if (payment?.status === "APPROVED" && item && trip) {
    if (isBalance) {
      return (
        <Card
          icon={
            <CheckCircle className="mx-auto h-12 w-12 text-success-deep" aria-hidden />
          }
          title="saldo pagado"
          actions={backToTrip("seguir el viaje")}
        >
          <p>ya está todo pago. podés seguir el viaje desde el detalle.</p>
        </Card>
      );
    }
    return (
      <Card
        icon={<CheckCircle className="mx-auto h-12 w-12 text-success-deep" aria-hidden />}
        title="seña acreditada"
        actions={backToTrip("ver mi carga")}
      >
        <p>
          reservaste {item.volume.toLocaleString("es-AR", { maximumFractionDigits: 2 })}{" "}
          m³ en {trip.origin} → {trip.destination}.{" "}
          {item.status === "CONFIRMED"
            ? "el fletero ya confirmó tu carga."
            : "ahora el fletero tiene que confirmar tu carga; te avisamos por mail."}
          {item.balanceAmount > 0 &&
            ` el saldo de ${currency(item.balanceAmount)} se paga cuando el viaje sale.`}
        </p>
      </Card>
    );
  }

  if (payment?.status === "REJECTED" && item) {
    return (
      <Card
        icon={<XCircle className="mx-auto h-12 w-12 text-danger" aria-hidden />}
        title="Mercado Pago rechazó el pago"
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={retry.isPending}
              onClick={() => retry.mutate({ cargoItemId: item.id, type: target.type })}
            >
              {retry.isPending ? "generando link…" : "reintentar pago"}
            </Button>
            {backToTrip("volver al viaje", "outline")}
          </>
        }
      >
        <p>
          no se cobró nada.
          {!isBalance && item.reservationExpiresAt
            ? ` tu lugar sigue reservado hasta el ${formatInstant(item.reservationExpiresAt)};`
            : ""}{" "}
          podés intentar con otro medio.
        </p>
        {retry.error instanceof Error && (
          <p role="alert" className="text-danger">
            {retry.error.message}
          </p>
        )}
      </Card>
    );
  }

  // devuelto, con contracargo, o la carga ya no está activa: no hay nada que
  // esperar de este pago
  if (payment && payment.status !== "PENDING") {
    return (
      <Card title="este pago ya no está activo" actions={backToTrip("volver al viaje")}>
        <p>el detalle del viaje tiene el estado de tu carga y de lo que se devolvió.</p>
      </Card>
    );
  }

  if (!timedOut) {
    return (
      <Card
        icon={
          <span
            className="mx-auto block h-12 w-12 animate-spin rounded-full border-4 border-canvas-line border-t-brand"
            aria-hidden
          />
        }
        title="estamos verificando tu pago"
        actions={null}
      >
        <p>
          Mercado Pago nos avisa en unos segundos. no cierres esta pestaña ni pagues de
          nuevo.
        </p>
      </Card>
    );
  }

  return (
    <Card
      icon={<Clock className="mx-auto h-12 w-12 text-ink-muted" aria-hidden />}
      title="tu pago todavía no se acreditó"
      actions={backToTrip("volver al viaje")}
    >
      <p>
        a veces Mercado Pago tarda unos minutos. te avisamos por mail apenas se acredite.
        no hace falta pagar de nuevo.
      </p>
    </Card>
  );
}
