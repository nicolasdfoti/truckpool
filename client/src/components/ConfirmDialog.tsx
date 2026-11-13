import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  /** el texto del botón de la acción; sin él, el diálogo es solo informativo */
  confirmLabel?: string;
  /** el botón que cierra sin hacer nada; recibe el foco al abrir */
  cancelLabel?: string;
  /** danger para lo que no tiene vuelta atrás (retirar, salir, cancelar) */
  tone?: "danger" | "primary";
  onConfirm?: () => void;
  onCancel: () => void;
  /** mientras corre la acción: los botones se bloquean y Escape no cierra */
  pending?: boolean;
  pendingLabel?: string;
  confirmDisabled?: boolean;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo de confirmación accesible (reemplaza a window.confirm): role="dialog"
 * con título y descripción asociados, foco inicial en el botón que no hace
 * nada, Tab atrapado adentro, Escape y clic afuera cierran, y al cerrar el foco
 * vuelve a donde estaba.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "volver",
  tone = "danger",
  onConfirm,
  onCancel,
  pending = false,
  pendingLabel,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // el último onCancel/pending sin volver a correr el efecto de apertura
  const latest = useRef({ onCancel, pending });
  useEffect(() => {
    latest.current = { onCancel, pending };
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!latest.current.pending) latest.current.onCancel();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={() => {
          if (!pending) onCancel();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        // RD1: en pantallas bajas el panel scrollea y los botones siguen al alcance
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="font-display text-lg font-medium text-ink">
          {title}
        </h2>
        <div id={bodyId} className="mt-3 space-y-2 text-sm text-ink-soft">
          {children}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          {confirmLabel && onConfirm && (
            <Button
              variant={tone === "danger" ? "danger-solid" : "dark"}
              size="sm"
              disabled={pending || confirmDisabled}
              onClick={onConfirm}
            >
              {pending && pendingLabel ? pendingLabel : confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
