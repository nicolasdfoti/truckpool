import { ConfirmDialog } from "./ConfirmDialog";
import { useCargoCancellationQuote } from "../hooks/useCargoCancellationQuote";
import type { CancellationQuote } from "../lib/cancellation";
import type { CargoItem } from "../types/trip";

function currency(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

/** la política que aplicó el server, en palabras: el client no cuenta horas */
const WINDOW_TEXT: Record<Exclude<CancellationQuote["window"], "CLOSED">, string> = {
  FULL_REFUND: "faltan más de 48 h para la salida: te devolvemos toda la seña.",
  PARTIAL_REFUND:
    "faltan entre 24 y 48 h para la salida: se retiene la mitad de la seña.",
  NO_REFUND: "faltan menos de 24 h para la salida: la seña no se devuelve.",
};

type Props = {
  tripId: string;
  /** la carga a retirar; null = cerrado */
  item: CargoItem | null;
  onCancel: () => void;
  onConfirm: (cargoItemId: string) => void;
  pending: boolean;
  error: string | null;
};

/**
 * U21 / 03§1.2: el retiro con el desglose del quote del server (seña sin pagar,
 * pagada, retenido y el plazo de MP). Vale igual para cargas PENDING y
 * CONFIRMED (D4) y se corta a la hora de salida: ahí el quote viene CLOSED y el
 * diálogo solo explica por qué.
 */
export function WithdrawCargoDialog({
  tripId,
  item,
  onCancel,
  onConfirm,
  pending,
  error,
}: Props) {
  const quoteQuery = useCargoCancellationQuote(tripId, item?.id ?? null);
  if (!item) return null;

  const loading = quoteQuery.isPending;
  const quote = quoteQuery.data ?? null;
  const closed = quote !== null && !quote.cancellable;

  if (closed) {
    return (
      <ConfirmDialog
        open
        title="esta carga ya no se puede retirar"
        cancelLabel="entendido"
        onCancel={onCancel}
      >
        <p>
          el viaje ya salió: la carga no se puede retirar. si el viaje no sale, se cancela
          y te devolvemos lo que pagaste de seña.
        </p>
      </ConfirmDialog>
    );
  }

  const deposit = item.depositPayment;
  const depositPaid = deposit?.status === "APPROVED";
  // por acreditarse: el pago existe en MP y sostiene la reserva (no vence)
  const depositInFlight =
    deposit?.status === "PENDING" && item.reservationExpiresAt === null;

  return (
    <ConfirmDialog
      open
      title="¿retirar esta carga?"
      confirmLabel="retirar carga"
      cancelLabel="mantener"
      tone="danger"
      onCancel={onCancel}
      onConfirm={() => onConfirm(item.id)}
      pending={pending}
      pendingLabel="retirando…"
      confirmDisabled={loading}
    >
      <p>
        liberás {item.volume.toLocaleString("es-AR", { maximumFractionDigits: 1 })} m³ (
        {item.description}).
        {item.status === "CONFIRMED" && " el fletero ya la había confirmado."}
      </p>
      {loading ? (
        <p className="text-ink-muted">calculando cuánto se devuelve…</p>
      ) : !quote ? (
        <p>no pudimos calcular el monto a devolver: te lo confirmamos al retirar.</p>
      ) : depositPaid ? (
        <>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md border border-line bg-canvas px-3 py-2">
            <dt>seña pagada</dt>
            <dd className="text-right font-medium text-ink">
              {currency(item.depositAmount)}
            </dd>
            <dt>te devolvemos</dt>
            <dd className="text-right font-medium text-ink">
              {currency(quote.refundAmount)}
            </dd>
            {quote.feeAmount > 0 && (
              <>
                <dt>se retiene</dt>
                <dd className="text-right font-medium text-danger">
                  {currency(quote.feeAmount)}
                </dd>
              </>
            )}
          </dl>
          {quote.window !== "CLOSED" && <p>{WINDOW_TEXT[quote.window]}</p>}
          {quote.refundAmount > 0 && (
            <p className="text-ink-muted">
              el reembolso lo procesa Mercado Pago y puede tardar unos días en verse en tu
              medio de pago.
            </p>
          )}
        </>
      ) : depositInFlight ? (
        <p>
          tu pago de la seña todavía se está acreditando. si se acredita después de
          retirar la carga, te lo devolvemos entero.
        </p>
      ) : (
        <p>todavía no pagaste la seña, así que no hay nada que devolver.</p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}
