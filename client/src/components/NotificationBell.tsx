import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check } from "./icons";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from "../hooks/useMarkNotificationRead";
import { useNotifications } from "../hooks/useNotifications";
import type { Notification } from "../types/notification";

/** "hace 5 min", "ayer": los avisos son cosas que acaban de pasar */
function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  return new Date(iso).toLocaleDateString("es-AR");
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: notifications = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unread = notifications.filter((n) => !n.read).length;
  const prevUnreadRef = useRef(unread);

  // Pulso cuando pasa de 0 a >0
  useEffect(() => {
    if (prevUnreadRef.current === 0 && unread > 0) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 800);
      return () => clearTimeout(timer);
    }
    prevUnreadRef.current = unread;
  }, [unread]);

  // el dropdown se cierra solo: click afuera o Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openNotification = (notification: Notification) => {
    if (!notification.read) markRead.mutate(notification.id);
    setOpen(false);
    if (notification.tripId) navigate(`/viajes/${notification.tripId}`);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `notificaciones (${unread} sin leer)` : "notificaciones"}
        aria-expanded={open}
        className="relative rounded-full p-2 text-ink-soft transition-colors hover:bg-canvas hover:text-brand"
      >
        <Bell size={22} />
        {unread > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white transition-transform duration-150 ${
              pulse ? "animate-ping" : ""
            }`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-line bg-white shadow-lg sm:w-96">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-display text-sm font-semibold text-ink">
              notificaciones
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-hover disabled:text-ink-muted"
              >
                <Check size={14} />
                marcar todas como leídas
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">
              no tenés notificaciones todavía
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas ${
                      notification.read ? "bg-white" : "bg-surface"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        notification.read ? "bg-transparent" : "bg-accent"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">
                        {notification.title}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-soft">
                        {notification.body}
                      </span>
                      <span className="mt-1 block text-xs text-ink-muted">
                        {relativeTime(notification.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
