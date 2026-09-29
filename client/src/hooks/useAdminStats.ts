import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export type AdminStats = {
  tripsByStatus: {
    OPEN: number;
    FULL: number;
    IN_TRANSIT: number;
    COMPLETED: number;
  };
  totalTrips: number;
  volumeTransported: number;
  /** null si la fase de pagos no está implementada */
  billedAmount: number | null;
  activeCarriers: number;
  activeCompanies: number;
  /** null si la fase de reviews no está implementada (o no hay reviews) */
  averageRating: number | null;
  /** por qué una métrica quedó en null */
  pendingReasons: Record<string, string>;
  notes: string[];
};

export function useAdminStats(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => api.get<{ stats: AdminStats }>("/admin/stats").then((d) => d.stats),
    enabled,
  });
}
