import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { useAuth } from "../hooks/useAuth";
import {
  useReceivedTripRequests,
  useSentTripRequests,
  useRespondTripRequest,
  useCreateTripRequest,
} from "../hooks/useTripRequests";
import { formatTripDate } from "../lib/tripWhen";
import type { TripRequest } from "../types/trip";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "pendiente",
  ACCEPTED: "aceptada",
  DECLINED: "rechazada",
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-brand/10 text-brand",
  ACCEPTED: "bg-success-bg text-success-deep",
  DECLINED: "bg-canvas-line text-ink-soft",
};

/** Formulario para responder (aceptar/rechazar) */
function RespondForm({
  requestId,
  accept,
  onClose,
}: {
  requestId: string;
  accept: boolean;
  onClose: () => void;
}): React.ReactElement {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [tripDetails, setTripDetails] = useState({
    truckType: "",
    capacityTotal: "",
    price: "",
    depositPercent: "20",
    features: [] as string[],
    departureTime: "",
  });
  const respond = useRespondTripRequest();

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setFormError(null);

    if (accept) {
      if (!tripDetails.truckType) {
        setFormError("elegí el tipo de vehículo.");
        return;
      }
      const cap = Number(tripDetails.capacityTotal);
      if (!tripDetails.capacityTotal || cap <= 0) {
        setFormError("ingresá una capacidad válida en m³.");
        return;
      }
      const pr = Number(tripDetails.price);
      if (!tripDetails.price || pr <= 0) {
        setFormError("ingresá un precio válido.");
        return;
      }
      const dep = Number(tripDetails.depositPercent);
      if (!Number.isInteger(dep) || dep < 10 || dep > 50) {
        setFormError("la seña va entre 10% y 50%.");
        return;
      }
      if (
        tripDetails.departureTime &&
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(tripDetails.departureTime)
      ) {
        setFormError("la hora de salida tiene que tener formato HH:mm.");
        return;
      }
    }

    setIsSubmitting(true);
    respond.mutate(
      {
        id: requestId,
        data: {
          accept,
          tripDetails: accept
            ? {
                truckType: tripDetails.truckType,
                capacityTotal: Number(tripDetails.capacityTotal),
                price: Number(tripDetails.price),
                depositPercent: Number(tripDetails.depositPercent),
                features: tripDetails.features,
                departureTime: tripDetails.departureTime || null,
              }
            : undefined,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (err: unknown): void => {
          setFormError(err instanceof Error ? err.message : "no se pudo responder.");
          setIsSubmitting(false);
        },
      }
    );
  };

  if (accept) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-ink-soft">
          completá los detalles para publicar el viaje:
        </p>

        <div>
          <label className="text-[13px] text-ink-soft" htmlFor="truckType">
            vehículo
          </label>
          <select
            id="truckType"
            value={tripDetails.truckType}
            onChange={(e) =>
              setTripDetails({ ...tripDetails, truckType: e.target.value })
            }
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
          >
            {["Semi", "Chasis", "Tráiler", "Camión"].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className="text-[13px] text-ink-soft" htmlFor="capacityTotal">
              capacidad (m³)
            </label>
            <input
              id="capacityTotal"
              value={tripDetails.capacityTotal}
              onChange={(e) =>
                setTripDetails({ ...tripDetails, capacityTotal: e.target.value })
              }
              placeholder="ej: 30"
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
            />
          </div>
          <div>
            <label className="text-[13px] text-ink-soft" htmlFor="price">
              precio del viaje
            </label>
            <input
              id="price"
              value={tripDetails.price}
              onChange={(e) => setTripDetails({ ...tripDetails, price: e.target.value })}
              placeholder="ej: 1500"
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
            />
          </div>
          <div>
            <label className="text-[13px] text-ink-soft" htmlFor="depositPercent">
              seña (%)
            </label>
            <input
              id="depositPercent"
              value={tripDetails.depositPercent}
              onChange={(e) =>
                setTripDetails({ ...tripDetails, depositPercent: e.target.value })
              }
              placeholder="20"
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
            />
          </div>
          <div>
            <label className="text-[13px] text-ink-soft" htmlFor="departureTime">
              hora de salida
            </label>
            <input
              id="departureTime"
              type="time"
              value={tripDetails.departureTime}
              onChange={(e) =>
                setTripDetails({ ...tripDetails, departureTime: e.target.value })
              }
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
            />
            <p className="mt-1 text-xs text-ink-muted">opcional</p>
          </div>
        </div>

        <div className="mt-4">
          <span className="text-[13px] text-ink-soft">servicios y extras</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[
              { value: "refrigeracion", label: "Refrigeración" },
              { value: "seguro", label: "Seguro" },
              { value: "carga_fragil", label: "Carga frágil" },
              { value: "expreso", label: "Expreso" },
              { value: "carga_y_descarga", label: "Carga y descarga" },
            ].map((feature) => (
              <label
                key={feature.value}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  tripDetails.features.includes(feature.value)
                    ? "border-brand bg-canvas text-ink"
                    : "border-line text-ink-soft"
                }`}
              >
                <input
                  type="checkbox"
                  checked={tripDetails.features.includes(feature.value)}
                  onChange={(e) =>
                    setTripDetails({
                      ...tripDetails,
                      features: e.target.checked
                        ? [...tripDetails.features, feature.value]
                        : tripDetails.features.filter((f) => f !== feature.value),
                    })
                  }
                  className="checkbox"
                />
                {feature.label}
              </label>
            ))}
          </div>
        </div>

        {formError && <p className="text-[13px] text-danger">{formError}</p>}

        <div className="flex gap-3 mt-4">
          <Button variant="ghost" type="button" onClick={onClose}>
            cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting || respond.isPending}>
            {isSubmitting || respond.isPending ? "procesando…" : "confirmar y publicar"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-ink-soft">
        ¿estás seguro de que querés rechazar esta solicitud?
      </p>
      {formError && <p className="text-[13px] text-danger">{formError}</p>}
      <div className="flex gap-3">
        <Button variant="ghost" type="button" onClick={onClose}>
          no, volver
        </Button>
        <Button
          variant="outline"
          type="submit"
          disabled={isSubmitting || respond.isPending}
        >
          {isSubmitting || respond.isPending ? "rechazando…" : "rechazar"}
        </Button>
      </div>
    </form>
  );
}

/** Formulario para crear una nueva solicitud de viaje (COMPANY) */
function CreateTripRequestForm({
  carrierId,
  carrierName,
  onClose,
}: {
  carrierId: string;
  carrierName: string;
  onClose: () => void;
}): React.ReactElement {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    origin: "",
    destination: "",
    desiredDate: "",
    estimatedVolume: "",
    note: "",
  });
  const createTripRequest = useCreateTripRequest();

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setFormError(null);

    if (!formData.origin.trim()) {
      setFormError("el origen es obligatorio.");
      return;
    }
    if (!formData.destination.trim()) {
      setFormError("el destino es obligatorio.");
      return;
    }
    if (!formData.desiredDate) {
      setFormError("la fecha deseada es obligatoria.");
      return;
    }
    const vol = Number(formData.estimatedVolume);
    if (!formData.estimatedVolume || vol <= 0) {
      setFormError("ingresá un volumen estimado válido en m³.");
      return;
    }
    const date = new Date(formData.desiredDate);
    if (isNaN(date.getTime()) || date < new Date()) {
      setFormError("la fecha no puede ser en el pasado.");
      return;
    }

    setIsSubmitting(true);
    createTripRequest.mutate(
      {
        carrierId,
        origin: formData.origin.trim(),
        destination: formData.destination.trim(),
        desiredDate: formData.desiredDate,
        estimatedVolume: vol,
        note: formData.note.trim() || undefined,
      },
      {
        onSuccess: () => onClose(),
        onError: (err: unknown): void => {
          setFormError(err instanceof Error ? err.message : "no se pudo enviar la solicitud.");
          setIsSubmitting(false);
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-ink-soft">
        completá los datos para solicitar el viaje a <strong>{carrierName}</strong>:
      </p>

      <div>
        <label className="text-[13px] text-ink-soft" htmlFor="origin">
          origen
        </label>
        <input
          id="origin"
          value={formData.origin}
          onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
          placeholder="ej: Córdoba, Argentina"
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
        />
      </div>

      <div>
        <label className="text-[13px] text-ink-soft" htmlFor="destination">
          destino
        </label>
        <input
          id="destination"
          value={formData.destination}
          onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
          placeholder="ej: Buenos Aires, Argentina"
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-[13px] text-ink-soft" htmlFor="desiredDate">
            fecha deseada
          </label>
          <input
            id="desiredDate"
            type="date"
            value={formData.desiredDate}
            onChange={(e) => setFormData({ ...formData, desiredDate: e.target.value })}
            min={new Date().toISOString().split("T")[0]}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
          />
        </div>
        <div>
          <label className="text-[13px] text-ink-soft" htmlFor="estimatedVolume">
            volumen estimado (m³)
          </label>
          <input
            id="estimatedVolume"
            type="number"
            step="0.1"
            min="0.1"
            value={formData.estimatedVolume}
            onChange={(e) => setFormData({ ...formData, estimatedVolume: e.target.value })}
            placeholder="ej: 25"
            inputMode="decimal"
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
          />
        </div>
      </div>

      <div>
        <label className="text-[13px] text-ink-soft" htmlFor="note">
          nota (opcional)
        </label>
        <textarea
          id="note"
          value={formData.note}
          onChange={(e) => setFormData({ ...formData, note: e.target.value })}
          placeholder="detalles adicionales: tipo de carga, requerimientos especiales, etc."
          rows={3}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand"
        />
      </div>

      {formError && <p className="text-[13px] text-danger">{formError}</p>}

      <div className="flex gap-3 mt-4">
        <Button variant="ghost" type="button" onClick={onClose}>
          cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "enviando…" : "enviar solicitud"}
        </Button>
      </div>
    </form>
  );
}

/** Item de solicitud recibida (CARRIER) */
function ReceivedRequestItem({
  request,
  onAccept,
  onDecline,
}: {
  request: TripRequest;
  onAccept: () => void;
  onDecline: () => void;
}): React.ReactElement {
  return (
    <li className="rounded-[10px] border border-line bg-white p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <p className="font-display text-lg font-medium">
            {request.origin} → {request.destination}
          </p>
          <p className="mt-1 flex flex-wrap gap-3 text-[13px] text-ink-muted">
            <span>
              fecha:{" "}
              <span className="text-ink font-medium">
                {formatTripDate(request.desiredDate)}
              </span>
            </span>
            <span>
              volumen:{" "}
              <span className="text-ink font-medium">
                {request.estimatedVolume.toFixed(1)} m³
              </span>
            </span>
            <span>
              empresa:{" "}
              <span className="text-ink font-medium">{request.company.name}</span>
            </span>
          </p>
          {request.note && (
            <p className="mt-2 text-[13px] text-ink-soft">
              <em>nota:</em> {request.note}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLES[request.status]}`}
          >
            {STATUS_LABELS[request.status]}
          </span>
          {request.status === "PENDING" && (
            <>
              <Button variant="primary" size="sm" onClick={onAccept}>
                aceptar
              </Button>
              <Button variant="ghost" size="sm" onClick={onDecline}>
                rechazar
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** Item de solicitud enviada (COMPANY) */
function SentRequestItem({ request }: { request: TripRequest }): React.ReactElement {
  return (
    <li className="rounded-[10px] border border-line bg-white p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <p className="font-display text-lg font-medium">
            {request.origin} → {request.destination}
          </p>
          <p className="mt-1 flex flex-wrap gap-3 text-[13px] text-ink-muted">
            <span>
              fecha:{" "}
              <span className="text-ink font-medium">
                {formatTripDate(request.desiredDate)}
              </span>
            </span>
            <span>
              volumen:{" "}
              <span className="text-ink font-medium">
                {request.estimatedVolume.toFixed(1)} m³
              </span>
            </span>
            <span>
              transportista:{" "}
              <span className="text-ink font-medium">{request.carrier.name}</span>
            </span>
          </p>
          {request.note && (
            <p className="mt-2 text-[13px] text-ink-soft">
              <em>nota:</em> {request.note}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLES[request.status]}`}
          >
            {STATUS_LABELS[request.status]}
          </span>
          {request.resultingTripId && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/viajes/${request.resultingTripId}`}>ver el viaje</Link>
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function TripRequests(): React.ReactElement {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Para COMPANY: solo "enviadas". Para CARRIER: solo "recibidas".
  const isCompany = user?.role === "COMPANY";
  const activeTab = isCompany ? "sent" : "received";

  const [openModal, setOpenModal] = useState<{
    type: "accept" | "decline" | "create";
    request?: TripRequest;
    carrierId?: string;
    carrierName?: string;
  } | null>(null);

  // COMPANY usa sent, CARRIER usa received
  const { data: sent, isLoading: loadingSent } = useSentTripRequests();
  const { data: received, isLoading: loadingReceived } = useReceivedTripRequests();

  const currentData = activeTab === "received" ? received : sent;
  const currentLoading = activeTab === "received" ? loadingReceived : loadingSent;

  /* eslint-disable react-hooks/set-state-in-effect */
// Si venimos de /fleteros/:id?action=request, abrir el modal de crear solicitud
  useEffect(() => {
    if (searchParams.get("action") === "request") {
      const carrierId = searchParams.get("carrierId");
      const carrierName = searchParams.get("carrierName");
      if (carrierId && carrierName) {
        setOpenModal({ type: "create", carrierId, carrierName });
        // Limpiar el query param para que no se abra de nuevo al recargar
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="font-display text-3xl font-semibold">Solicitudes de viaje</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {activeTab === "received"
            ? "pedidos que te hicieron empresas. aceptá para publicar el viaje, o rechazá si no podés."
            : "pedidos que enviaste a transportistas. verás el estado y el link al viaje si lo aceptaron."}
        </p>

        {currentLoading && (
          <div className="mt-8 space-y-4" role="status" aria-label="cargando">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-[10px] border border-line bg-white p-5"
              >
                <div className="h-6 w-3/4 bg-canvas-line rounded" />
                <div className="mt-2 h-4 w-1/2 bg-canvas-line rounded" />
              </div>
            ))}
          </div>
        )}

        {!currentLoading && currentData && currentData.length === 0 && (
          <div className="mt-10 rounded-[10px] border border-line bg-white p-8 text-center">
            <p className="text-sm text-ink-muted">
              {activeTab === "received"
                ? "no recibiste ninguna solicitud todavía."
                : "no enviaste ninguna solicitud todavía."}
            </p>
            {activeTab === "sent" && (
              <Button asChild variant="primary" size="md" className="mt-4">
                <Link to="/fleteros">buscar un transportista</Link>
              </Button>
            )}
          </div>
        )}

        {!currentLoading && currentData && currentData.length > 0 && (
          <ul className="mt-6 space-y-4" role="list">
            {activeTab === "received"
              ? currentData.map((request) => (
                  <ReceivedRequestItem
                    key={request.id}
                    request={request}
                    onAccept={() => setOpenModal({ type: "accept", request })}
                    onDecline={() => setOpenModal({ type: "decline", request })}
                  />
                ))
              : currentData.map((request) => (
                  <SentRequestItem key={request.id} request={request} />
                ))}
          </ul>
        )}

        {openModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="w-full max-w-xl rounded-[10px] bg-white p-6 shadow-xl">
              {openModal.type === "create" ? (
                <>
                  <h2 className="font-display text-xl font-semibold mb-4">
                    solicitar viaje a <strong>{openModal.carrierName}</strong>
                  </h2>
                  <CreateTripRequestForm
                    carrierId={openModal.carrierId!}
                    carrierName={openModal.carrierName!}
                    onClose={() => setOpenModal(null)}
                  />
                </>
              ) : (
                <>
                  <h2 className="font-display text-xl font-semibold mb-4">
                    {openModal.type === "accept"
                      ? `aceptar: ${openModal.request!.origin} → ${openModal.request!.destination}`
                      : `rechazar: ${openModal.request!.origin} → ${openModal.request!.destination}`}
                  </h2>
                  <RespondForm
                    requestId={openModal.request!.id}
                    accept={openModal.type === "accept"}
                    onClose={() => setOpenModal(null)}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}