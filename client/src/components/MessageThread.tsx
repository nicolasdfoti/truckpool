import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "./Button";
import { useTripMessages } from "../hooks/useTripMessages";
import { useSendMessage } from "../hooks/useSendMessage";
import { useMarkMessagesRead } from "../hooks/useMarkMessagesRead";

const inputClass =
  "mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand";

type MessageThreadProps = {
  tripId: string;
  currentUserId: string;
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessageThread({ tripId, currentUserId }: MessageThreadProps) {
  const { data, isLoading } = useTripMessages(tripId);
  const sendMessage = useSendMessage(tripId);
  const markRead = useMarkMessagesRead(tripId);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickedCompanyId, setPickedCompanyId] = useState<string | null>(null);
  // mensajes que estaban sin leer al abrir esta conversación: el badge queda
  // visible durante la visita aunque los marquemos como leídos enseguida.
  const [unreadOnOpen, setUnreadOnOpen] = useState(0);
  const countedRef = useRef<string | null>(null);
  const markedRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const carrier = data?.participants.carrier ?? null;
  const companies = useMemo(() => data?.participants.companies ?? [], [data]);
  const hasManyCompanies = companies.length > 1;
  const isCarrierOfTrip = carrier?.id === currentUserId;

  // la empresa siempre habla con el transportista; el fletero elige una de las
  // empresas con carga (si hay más de una, tiene que elegir).
  const selectedId = useMemo(() => {
    if (!data) return null;
    if (!isCarrierOfTrip) return carrier?.id ?? null;
    if (pickedCompanyId) return pickedCompanyId;
    if (companies.length === 1) return companies[0]?.id ?? null;
    return null;
  }, [data, isCarrierOfTrip, carrier, companies, pickedCompanyId]);

  const messages = useMemo(() => {
    if (!data) return [];
    if (!selectedId) return [];
    // en una conversación solo se ven los mensajes de ida y vuelta entre
    // los dos participantes.
    return data.messages.filter(
      (message) =>
        (message.fromUserId === currentUserId && message.toUserId === selectedId) ||
        (message.fromUserId === selectedId && message.toUserId === currentUserId)
    );
  }, [data, currentUserId, selectedId]);

  const pendingRead = messages.filter(
    (message) => message.toUserId === currentUserId && message.readAt === null
  ).length;

  useEffect(() => {
    if (!selectedId || !data) return;
    if (countedRef.current === selectedId) return;
    countedRef.current = selectedId;
    setUnreadOnOpen(pendingRead);
    markedRef.current = 0;
  }, [selectedId, data, pendingRead]);

  // al abrir el thread marcamos lo dirigido a vos como leído (best-effort)
  useEffect(() => {
    if (pendingRead === 0 || markedRef.current === pendingRead) return;
    markedRef.current = pendingRead;
    markRead.mutate();
  }, [pendingRead, markRead]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, selectedId]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedId) {
      setError("elegí con quién querés hablar.");
      return;
    }
    if (!body.trim()) {
      setError("escribí un mensaje.");
      return;
    }

    sendMessage.mutate(
      { body: body.trim(), toUserId: selectedId },
      {
        onSuccess: () => setBody(""),
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : "no se pudo enviar el mensaje.");
        },
      }
    );
  }

  return (
    <section className="rounded-[10px] border border-line bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[17px] font-medium">mensajes</h2>
        {unreadOnOpen > 0 && (
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-ink">
            {unreadOnOpen} sin leer
          </span>
        )}
      </div>

      {isCarrierOfTrip && hasManyCompanies && (
        <div className="mt-4">
          <label className="text-[13px] text-ink-soft" htmlFor="counterpart">
            hablar con
          </label>
          <select
            id="counterpart"
            value={selectedId ?? ""}
            onChange={(e) => setPickedCompanyId(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              elegí una empresa
            </option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading && <p className="mt-4 text-sm text-ink-muted">cargando mensajes…</p>}

      {!isLoading && isCarrierOfTrip && !selectedId && hasManyCompanies && (
        <p className="mt-4 text-sm text-ink-muted">
          este viaje tiene varias empresas con carga: elegí con quién querés hablar.
        </p>
      )}

      {!isLoading && selectedId && messages.length === 0 && (
        <p className="mt-4 text-sm text-ink-muted">
          todavía no hay mensajes. escribí el primero.
        </p>
      )}

      {messages.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {messages.map((message) => {
            const mine = message.fromUserId === currentUserId;
            return (
              <li
                key={message.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-[10px] px-3 py-2 ${
                    mine ? "bg-brand text-white" : "bg-canvas text-ink-soft"
                  }`}
                >
                  {!mine && (
                    <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                      {message.fromName}
                    </p>
                  )}
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {message.body}
                  </p>
                  <p
                    className={`mt-1 text-[11px] ${mine ? "text-white/70" : "text-ink-muted"}`}
                  >
                    {formatTime(message.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
          <div ref={endRef} />
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <label className="sr-only" htmlFor="message-body">
            mensaje
          </label>
          <textarea
            id="message-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              selectedId ? "escribí un mensaje…" : "elegí con quién querés hablar"
            }
            rows={2}
            maxLength={1000}
            disabled={!selectedId}
            className={inputClass}
          />
        </div>
        <Button type="submit" disabled={sendMessage.isPending || !selectedId}>
          {sendMessage.isPending ? "enviando…" : "enviar"}
        </Button>
      </form>

      {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
      {sendMessage.error && (
        <p className="mt-2 text-[13px] text-danger">{sendMessage.error.message}</p>
      )}
    </section>
  );
}
