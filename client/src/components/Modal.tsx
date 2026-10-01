import { Fragment, type ReactNode } from "react";
import { X } from "./icons";

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
};

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  className = "",
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <Fragment>
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div
          className="w-full max-w-md rounded-[10px] bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <h2 id="modal-title" className="font-display text-lg font-medium text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-ink-muted hover:text-ink p-1 rounded-md transition-colors"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-4">{children}</div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-brand hover:text-brand-hover transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      </div>
    </Fragment>
  );
}