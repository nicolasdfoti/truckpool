import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "../components/Button";
import { useAuth } from "../hooks/useAuth";
import { usePendingVerifications, useReviewVerification } from "../hooks/useUserProfile";

const inputClass = "input mt-1.5";

export default function AdminVerifications() {
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const verifications = usePendingVerifications(isAdmin);
  const review = useReviewVerification();

  const [rejectedId, setRejectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!authLoading && !isAdmin) return <Navigate to="/" replace />;

  function handleReject(userId: string) {
    setError(null);
    if (!note.trim()) {
      setError("contale al transportista por qué rechazás la verificación.");
      return;
    }
    review.mutate(
      { userId, approve: false, note: note.trim() },
      {
        onSuccess: () => {
          setRejectedId(null);
          setNote("");
        },
        onError: (err: unknown) => {
          setError(
            err instanceof Error ? err.message : "no se pudo rechazar la verificación."
          );
        },
      }
    );
  }

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">
          Verificaciones de identidad
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          revisá el DNI o CUIT de cada transportista antes de que publique viajes.
        </p>

        {authLoading && (
          <p className="mt-8 text-sm text-ink-muted">revisando tu sesión…</p>
        )}

        {isAdmin && verifications.isLoading && (
          <p className="mt-8 text-sm text-ink-muted">cargando solicitudes…</p>
        )}

        {/* QW7: con un error la página quedaba en blanco */}
        {isAdmin && verifications.isError && (
          <div
            role="alert"
            className="mt-8 rounded-md bg-danger/10 px-3 py-3 text-[13px] text-danger"
          >
            <p>no pudimos cargar las verificaciones pendientes.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={verifications.isFetching}
              onClick={() => verifications.refetch()}
            >
              {verifications.isFetching ? "reintentando…" : "reintentar"}
            </Button>
          </div>
        )}

        {isAdmin && error && (
          <p className="mt-6 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}

        {isAdmin && verifications.data && verifications.data.length === 0 && (
          <p className="mt-8 text-sm text-ink-muted">
            no hay verificaciones esperando revisión.
          </p>
        )}

        {isAdmin && verifications.data && verifications.data.length > 0 && (
          <ul className="mt-8 grid gap-4">
            {verifications.data.map((item) => {
              // Admin#1: sin DNI/CUIT no se aprueba (el server da 409); se rechaza
              // con nota para que lo cargue
              const missingTaxId = !item.taxId?.trim();
              const reasonId = `sin-cuit-${item.id}`;
              return (
                <li key={item.id} className="rounded-xl border border-line bg-white p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-[13px] text-ink-muted">{item.email}</p>
                      <p className="mt-2 text-sm">
                        dni/cuit:{" "}
                        <span className="font-medium">
                          {item.taxId ?? "no informado"}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        enviada el{" "}
                        {new Date(item.requestedAt).toLocaleDateString("es-AR")}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={review.isPending || missingTaxId}
                          aria-describedby={missingTaxId ? reasonId : undefined}
                          onClick={() =>
                            review.mutate(
                              { userId: item.id, approve: true },
                              {
                                onError: (err: unknown) =>
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : "no se pudo aprobar la verificación."
                                  ),
                              }
                            )
                          }
                        >
                          aprobar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setError(null);
                            setRejectedId(rejectedId === item.id ? null : item.id);
                            setNote("");
                          }}
                        >
                          rechazar
                        </Button>
                      </div>
                      {missingTaxId && (
                        <p id={reasonId} className="text-xs text-ink-soft">
                          sin CUIT no se puede aprobar
                        </p>
                      )}
                    </div>
                  </div>

                  {rejectedId === item.id && (
                    <div className="mt-4 border-t border-line pt-4">
                      <label className="field-label" htmlFor={`note-${item.id}`}>
                        Motivo del rechazo
                      </label>
                      <input
                        id={`note-${item.id}`}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="ej: el CUIT no coincide con el titular"
                        className={inputClass}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        className="mt-3"
                        disabled={review.isPending}
                        onClick={() => handleReject(item.id)}
                      >
                        {review.isPending ? "guardando…" : "confirmar rechazo"}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-10 text-sm text-ink-muted">
          <Link to="/" className="text-brand underline">
            volver al inicio
          </Link>
        </p>
      </main>
    </div>
  );
}
