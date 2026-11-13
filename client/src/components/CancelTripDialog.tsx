import { ConfirmDialog } from "./ConfirmDialog";
import type { CargoItem } from "../types/trip";

type Props = {
  open: boolean;
  items: CargoItem[];
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: string | null;
};

/**
 * D6 = a: el fletero cancela el viaje antes de salir. Las cargas activas se
 * cancelan y la seña cobrada vuelve entera (el server la devuelve por el
 * outbox). Acá solo se cuenta a quién: el monto no se calcula en el client.
 */
export function CancelTripDialog({
  open,
  items,
  onCancel,
  onConfirm,
  pending,
  error,
}: Props) {
  const active = items.filter((c) => c.status === "PENDING" || c.status === "CONFIRMED");
  const paidCompanies = new Set(
    active.filter((c) => c.depositPayment?.status === "APPROVED").map((c) => c.companyId)
  ).size;

  return (
    <ConfirmDialog
      open={open}
      title="¿cancelar el viaje?"
      confirmLabel="cancelar viaje"
      cancelLabel="volver"
      tone="danger"
      onCancel={onCancel}
      onConfirm={onConfirm}
      pending={pending}
      pendingLabel="cancelando…"
    >
      <p>
        {active.length === 0
          ? "el viaje no tiene cargas activas."
          : active.length === 1
            ? "se cancela la carga activa del viaje."
            : `se cancelan las ${active.length} cargas activas del viaje.`}
      </p>
      {paidCompanies > 0 ? (
        <p>
          se devuelve el 100 % de la seña a{" "}
          {paidCompanies === 1 ? "1 empresa" : `${paidCompanies} empresas`}.
        </p>
      ) : (
        active.length > 0 && (
          <p>ninguna empresa pagó la seña todavía: no hay nada que devolver.</p>
        )
      )}
      {active.length > 0 && (
        <p>si alguna seña se acredita después, también se devuelve entera.</p>
      )}
      <p>las empresas reciben el aviso. esto no se puede deshacer.</p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}
