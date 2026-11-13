import type { CargoItem } from "../types/trip";

/** lo que el fletero tiene que saber antes de salir, de las cargas del viaje */
export function departureSummary(items: CargoItem[]) {
  const confirmed = items.filter((c) => c.status === "CONFIRMED");
  const pending = items.filter((c) => c.status === "PENDING");
  const pendingPaid = pending.filter((c) => c.depositPayment?.status === "APPROVED");
  return {
    confirmed,
    pending,
    pendingPaid,
    confirmedVolume: confirmed.reduce((sum, c) => sum + c.volume, 0),
    /** las que tienen la seña pagada: las confirmadas y las que faltan confirmar */
    withDeposit: confirmed.length + pendingPaid.length,
  };
}
