import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./Button";
import { departureSummary } from "../lib/departure";
import type { CargoItem } from "../types/trip";

function m3(n: number) {
  return `${n.toLocaleString("es-AR", { maximumFractionDigits: 1 })} m³`;
}

function cargas(n: number, adjetivo: string) {
  return n === 1 ? `1 carga ${adjetivo}` : `${n} cargas ${adjetivo}s`;
}

type Props = {
  open: boolean;
  items: CargoItem[];
  onCancel: () => void;
  onDepart: () => void;
  departing: boolean;
  onConfirmCargo: (cargoItemId: string) => void;
  /** la carga que se está confirmando ahora (null si ninguna) */
  confirmingId: string | null;
  error: string | null;
};

/**
 * D3 / 03§1.4: «marcar en tránsito» no tiene vuelta atrás. Antes de salir, el
 * fletero ve qué lleva, qué se cancela (las PENDING, con la seña devuelta
 * entera) y puede confirmar ahí mismo las que tienen la seña pagada.
 */
export function DepartTripDialog({
  open,
  items,
  onCancel,
  onDepart,
  departing,
  onConfirmCargo,
  confirmingId,
  error,
}: Props) {
  const { confirmed, pending, pendingPaid, confirmedVolume } = departureSummary(items);
  const busy = departing || confirmingId !== null;

  return (
    <ConfirmDialog
      open={open}
      title="¿salís ahora?"
      confirmLabel={
        confirmed.length === 0
          ? "salir sin cargas"
          : `salir con ${confirmed.length === 1 ? "1 carga" : `${confirmed.length} cargas`}`
      }
      cancelLabel="volver"
      tone="danger"
      onCancel={onCancel}
      onConfirm={onDepart}
      pending={departing}
      pendingLabel="marcando…"
      confirmDisabled={confirmingId !== null}
    >
      <p>
        {confirmed.length === 0
          ? "no tenés cargas confirmadas: salís sin llevar nada."
          : `vas a llevar ${cargas(confirmed.length, "confirmada")} (${m3(confirmedVolume)}).`}
      </p>
      {pending.length > 0 && (
        <p>
          {pending.length === 1
            ? "hay 1 carga sin confirmar: si salís, se cancela"
            : `hay ${pending.length} cargas sin confirmar: si salís, se cancelan`}{" "}
          y a cada empresa le devolvemos la seña que haya pagado.
        </p>
      )}
      {pendingPaid.length > 0 && (
        <div>
          <p>estas ya tienen la seña pagada; si las vas a llevar, confirmalas antes:</p>
          <ul className="mt-2 space-y-2">
            {pendingPaid.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
              >
                <span className="text-ink">
                  {item.description} · {m3(item.volume)}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onConfirmCargo(item.id)}
                >
                  {confirmingId === item.id ? "confirmando…" : "confirmar"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirmed.length > 0 && (
        <p>las empresas confirmadas van a recibir el aviso para pagar el saldo.</p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}
