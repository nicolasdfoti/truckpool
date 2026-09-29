import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { StatusBadge } from "../components/StatusBadge";
import { TripCard } from "../components/TripCard";
import { Truck } from "../components/icons";
import { useAuth } from "../hooks/useAuth";
import { useConnectMp } from "../hooks/useConnectMp";
import {
  useMyCargoItems,
  useMyProfile,
  useMyTrips,
  useRequestVerification,
  useToggleAvailability,
  useUpdateProfile,
} from "../hooks/useUserProfile";
import type { TripStatus } from "../types/trip";
import type { MyCargoItem, VerificationStatus } from "../types/user";
import { cancellationNote } from "../lib/cancellation";
import { LoadingBlock, SkeletonBar } from "../components/Loading";

const inputClass =
  "mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-brand";

/** qué pasó con la conexión, según el motivo que devuelve el callback */
const MP_ERROR_COPY: Record<string, string> = {
  MP_OAUTH_DENIED: "no autorizaste la conexión con Mercado Pago.",
  MP_OAUTH_MISSING_STATE: "la conexión llegó sin el state de seguridad.",
  MP_OAUTH_INVALID_STATE: "la conexión expiró. volvé a intentarlo.",
  MP_OAUTH_MISSING_CODE: "Mercado Pago no devolvió el código de autorización.",
  MP_TOKEN_NOT_ENCRYPTED:
    "el token que teníamos guardado quedó sin cifrar: hay que volver a conectar la cuenta.",
  MP_NOT_CONFIGURED: "la conexión con Mercado Pago todavía no está configurada.",
};

const VERIFICATION_COPY: Record<
  VerificationStatus,
  { label: string; hint: string; className: string }
> = {
  UNVERIFIED: {
    label: "sin verificar",
    hint: "mandá tu DNI o CUIT para que podamos verificar tu identidad.",
    className: "bg-canvas-line text-ink-soft",
  },
  PENDING: {
    label: "en revisión",
    hint: "estamos revisando tus datos. te avisamos apenas haya un resultado.",
    className: "bg-step-1 text-accent-ink",
  },
  VERIFIED: {
    label: "verificado",
    hint: "tu identidad está verificada: ya podés publicar viajes.",
    className: "bg-success-soft text-success-deep",
  },
  REJECTED: {
    label: "rechazada",
    hint: "no pudimos validar tus datos. corregí el DNI/CUIT y volvé a intentarlo.",
    className: "bg-danger/10 text-danger",
  },
};

function currency(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

/** una línea con el estado del dinero de la carga: qué se pagó y qué falta */
function moneyLine(item: MyCargoItem) {
  if (item.status === "CANCELLED") return cancellationNote(item);
  const parts = [
    item.depositPayment?.status === "APPROVED"
      ? `seña de ${currency(item.depositAmount)} pagada`
      : `seña de ${currency(item.depositAmount)} pendiente`,
  ];
  if (item.balancePayment?.status === "APPROVED") {
    parts.push("saldo pagado");
  } else if (item.balancePayment) {
    parts.push(`saldo de ${currency(item.balancePayment.amount)} pendiente`);
  }
  return parts.join(" · ");
}

export default function Profile() {
  const { user, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useMyProfile(Boolean(user));
  const updateProfile = useUpdateProfile();
  const toggleAvailability = useToggleAvailability();
  const myTrips = useMyTrips(user?.role === "CARRIER");
  const myCargoItems = useMyCargoItems(user?.role === "COMPANY");
  const connectMp = useConnectMp();

  // al volver de Mercado Pago el callback nos redirige con ?mp=connected o
  // ?mp=error&reason=..., así que el usuario no vuelve sin ninguna señal
  const [searchParams, setSearchParams] = useSearchParams();
  const mpResult = searchParams.get("mp");
  const mpReason = searchParams.get("reason");

  function dismissMpNotice() {
    const next = new URLSearchParams(searchParams);
    next.delete("mp");
    next.delete("reason");
    // replace para que el mensaje no vuelva al apretar atrás
    setSearchParams(next, { replace: true });
  }

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);
  const [taxId, setTaxId] = useState("");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const requestVerification = useRequestVerification();

  if (profile && profile.id !== loadedProfileId) {
    setLoadedProfileId(profile.id);
    setName(profile.name);
    setBio(profile.bio ?? "");
    setPhone(profile.phone ?? "");
    setTaxId(profile.taxId ?? "");
    setEmailNotifications(profile.emailNotifications);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaved(false);

    if (!name.trim()) {
      setFormError("el nombre no puede quedar vacío.");
      return;
    }

    updateProfile.mutate(
      {
        name: name.trim(),
        bio: bio.trim(),
        phone: phone.trim(),
        emailNotifications,
      },
      {
        onSuccess: () => setSaved(true),
        onError: (err: unknown) => {
          setFormError(
            err instanceof Error ? err.message : "no se pudo guardar el perfil."
          );
        },
      }
    );
  }

  function handleVerificationSubmit(e: FormEvent) {
    e.preventDefault();
    setVerificationError(null);

    if (!taxId.trim()) {
      setVerificationError("ingresá tu DNI o CUIT.");
      return;
    }

    requestVerification.mutate(taxId.trim(), {
      onError: (err: unknown) => {
        setVerificationError(
          err instanceof Error ? err.message : "no se pudo enviar la solicitud."
        );
      },
    });
  }

  return (
    <div className="bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">Tu perfil</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {user?.role === "COMPANY"
            ? "cargá tus datos de contacto para que los fleteros sepan con quién hablan."
            : "cargá tu bio y un teléfono así las empresas saben con quién hablan."}
        </p>

        {mpResult === "connected" && (
          <div
            role="status"
            className="mt-6 flex items-start justify-between gap-4 rounded-[10px] border border-line bg-success-soft px-4 py-3"
          >
            <p className="text-sm text-success-deep">
              tu cuenta de Mercado Pago quedó conectada. ya podés recibir pagos.
            </p>
            <button
              type="button"
              onClick={dismissMpNotice}
              className="text-sm text-success-deep underline"
            >
              cerrar
            </button>
          </div>
        )}

        {mpResult === "error" && (
          <div
            role="alert"
            className="mt-6 flex items-start justify-between gap-4 rounded-[10px] border border-line bg-danger/10 px-4 py-3"
          >
            <p className="text-sm text-danger">
              {MP_ERROR_COPY[mpReason ?? ""] ??
                "no pudimos conectar tu cuenta de Mercado Pago."}
            </p>
            <button
              type="button"
              onClick={dismissMpNotice}
              className="text-sm text-danger underline"
            >
              cerrar
            </button>
          </div>
        )}

        {authLoading && (
          <LoadingBlock label="revisando tu sesión" className="mt-8 space-y-6">
            <SkeletonBar className="h-5 w-1/3" />
            <SkeletonBar className="h-32 w-full" />
          </LoadingBlock>
        )}

        {!authLoading && !user && (
          <div className="mt-8 rounded-[10px] border border-line bg-white p-6">
            <p className="text-sm text-ink-muted">
              para ver tu perfil necesitás una cuenta:{" "}
              <Link
                to="/ingresar?tab=register&role=company"
                className="text-brand underline"
              >
                crear cuenta
              </Link>{" "}
              ·{" "}
              <Link to="/ingresar" className="text-brand underline">
                ingresar
              </Link>
            </p>
          </div>
        )}

        {!authLoading && user && profileLoading && (
          <LoadingBlock label="cargando tu perfil" className="mt-8 space-y-6">
            <SkeletonBar className="h-5 w-1/3" />
            <SkeletonBar className="h-32 w-full" />
            <SkeletonBar className="h-24 w-full" />
          </LoadingBlock>
        )}

        {!authLoading && user && profile && (
          <>
            <form
              onSubmit={handleSubmit}
              className="mt-8 rounded-[10px] border border-line bg-white p-6"
            >
              <div>
                <label className="text-[13px] text-ink-soft" htmlFor="name">
                  nombre
                </label>
                <input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="mt-4">
                <label className="text-[13px] text-ink-soft" htmlFor="bio">
                  bio
                </label>
                <textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="ej: transportista hace 10 años, cubrimos todo el centro del país"
                  rows={3}
                  className={inputClass}
                />
              </div>

              <div className="mt-4">
                <label className="text-[13px] text-ink-soft" htmlFor="phone">
                  teléfono
                </label>
                <input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="ej: 351 555-1234"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-muted">
                  {user?.role === "COMPANY"
                    ? "los fleteros usan este teléfono para coordinar la carga."
                    : "si sos fletero, aparece en tu perfil público."}
                </p>
              </div>

              <label className="mt-5 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={emailNotifications}
                  onChange={(e) => setEmailNotifications(e.target.checked)}
                  className="checkbox mt-0.5"
                />
                <span>
                  <span className="block text-[13px] text-ink-soft">
                    recibir notificaciones por email
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {user?.role === "COMPANY"
                      ? "te avisamos cuando un fletero suma carga a tus viajes, cuando confirman tu carga y cuando el viaje sale o termina."
                      : "te avisamos cuando una empresa suma carga a tus viajes, cuando confirman tu carga y cuando el viaje sale o termina."}
                  </span>
                </span>
              </label>

              {user.role === "CARRIER" && profile && (
                <label className="mt-5 flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={profile.isAvailableNow}
                    onChange={(e) => {
                      const next = e.target.checked;
                      toggleAvailability.mutate(next, {
                        onError: () => setFormError("no se pudo cambiar la disponibilidad"),
                      });
                    }}
                    className="checkbox mt-0.5"
                  />
                  <span>
                    <span className="block text-[13px] text-ink-soft">
                      disponible ahora
                    </span>
                    <span className="block text-xs text-ink-muted">
                      las empresas saben que respondés rápido si te piden un viaje ahora.
                    </span>
                  </span>
                </label>
              )}

              {formError && <p className="mt-4 text-[13px] text-danger">{formError}</p>}
              {saved && (
                <p className="mt-4 text-[13px] text-success-deep">perfil guardado.</p>
              )}

              <Button
                type="submit"
                className="mt-6 w-full"
                disabled={updateProfile.isPending}
              >
                {updateProfile.isPending ? "guardando…" : "guardar perfil"}
              </Button>
            </form>

            {user.role === "CARRIER" && profile && (
              <section className="mt-10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-[17px] font-medium">
                    verificación de identidad
                  </h2>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${VERIFICATION_COPY[profile.verificationStatus].className}`}
                  >
                    {VERIFICATION_COPY[profile.verificationStatus].label}
                  </span>
                </div>

                <div className="mt-3 rounded-[10px] border border-line bg-white p-6">
                  <p className="text-sm text-ink-muted">
                    {VERIFICATION_COPY[profile.verificationStatus].hint}
                  </p>

                  {profile.verificationStatus === "REJECTED" &&
                    profile.verificationNote && (
                      <p className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-[13px] text-danger">
                        motivo del rechazo: {profile.verificationNote}
                      </p>
                    )}

                  {profile.verificationStatus !== "VERIFIED" &&
                    profile.verificationStatus !== "PENDING" && (
                      <form onSubmit={handleVerificationSubmit} className="mt-4">
                        <label className="text-[13px] text-ink-soft" htmlFor="taxId">
                          dni o cuit
                        </label>
                        <input
                          id="taxId"
                          value={taxId}
                          onChange={(e) => setTaxId(e.target.value)}
                          placeholder="ej: 20345678901"
                          className={inputClass}
                        />

                        {verificationError && (
                          <p className="mt-3 text-[13px] text-danger">
                            {verificationError}
                          </p>
                        )}

                        <Button
                          type="submit"
                          className="mt-4"
                          disabled={requestVerification.isPending}
                        >
                          {requestVerification.isPending
                            ? "enviando…"
                            : profile.verificationStatus === "REJECTED"
                              ? "reenviar datos"
                              : "solicitar verificación"}
                        </Button>
                      </form>
                    )}
                </div>
              </section>
            )}

            {user.role === "CARRIER" && profile && (
              <section className="mt-10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-[17px] font-medium">
                    cuenta de cobro (Mercado Pago)
                  </h2>
                  {profile.mpConnected ? (
                    <span className="inline-flex items-center rounded-full bg-success-soft text-success-deep px-3 py-1 text-xs font-medium">
                      cuenta conectada
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-danger/10 text-danger px-3 py-1 text-xs font-medium">
                      sin conectar
                    </span>
                  )}
                </div>
                <div className="mt-3 rounded-[10px] border border-line bg-white p-6">
                  {profile.mpConnected ? (
                    <p className="text-sm text-ink-muted">
                      tu cuenta de Mercado Pago está conectada. Los pagos se dividen
                      automáticamente entre vos y la plataforma.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-ink-muted">
                        para recibir pagos de las empresas, necesitás conectar tu cuenta
                        de Mercado Pago. Así los pagos se dividen automáticamente: vos
                        recibís tu parte y la plataforma retiene su comisión.
                      </p>
                      <Button
                        variant="primary"
                        size="md"
                        className="mt-4"
                        type="button"
                        onClick={() => connectMp.mutate()}
                        disabled={connectMp.isPending}
                      >
                        {connectMp.isPending
                          ? "te llevamos a Mercado Pago…"
                          : "conectar Mercado Pago"}
                      </Button>
                      {connectMp.isError && (
                        <p className="mt-3 text-sm text-danger" role="alert">
                          no pudimos iniciar la conexión: {connectMp.error.message}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}

            {user.role === "CARRIER" && (
              <section className="mt-10">
                <h2 className="font-display text-[17px] font-medium">mis viajes</h2>
                {myTrips.isLoading && (
                  <p className="mt-2 text-sm text-ink-muted">cargando tus viajes…</p>
                )}
                {myTrips.data && myTrips.data.length === 0 && (
                  <p className="mt-2 text-sm text-ink-muted">
                    todavía no publicaste viajes.{" "}
                    <Link to="/viajes/nuevo" className="text-brand underline">
                      publicar el primero
                    </Link>
                  </p>
                )}
                {myTrips.data && myTrips.data.length > 0 && (
                  <ul className="mt-3 grid gap-4">
                    {myTrips.data.map((trip) => (
                      <li key={trip.id}>
                        {/* el hover es el mismo de TripCard: el texto de la ruta
                            (que no fija color propio) pasa a brand. showCarrier
                            fuera porque un link no puede contener otro link. */}
                        <Link
                          to={`/viajes/${trip.id}`}
                          className="block rounded-[10px] hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
                        >
                          <TripCard
                            trip={trip}
                            as="div"
                            showCarrier={false}
                            footer={null}
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {user.role === "COMPANY" && (
              <section className="mt-10">
                <h2 className="font-display text-[17px] font-medium">mis cargas</h2>
                {myCargoItems.isLoading && (
                  <p className="mt-2 text-sm text-ink-muted">cargando tus cargas…</p>
                )}
                {myCargoItems.data && myCargoItems.data.length === 0 && (
                  <p className="mt-2 text-sm text-ink-muted">
                    todavía no sumaste carga a ningún viaje.{" "}
                    <Link to="/viajes" className="text-brand underline">
                      mirar viajes abiertos
                    </Link>
                  </p>
                )}
                {myCargoItems.data && myCargoItems.data.length > 0 && (
                  <ul className="mt-3 space-y-3">
                    {myCargoItems.data.map((item) => (
                      <li key={item.id}>
                        <Link
                          to={`/viajes/${item.tripId}`}
                          className="flex items-center justify-between gap-4 rounded-[10px] border border-line bg-white p-4 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
                        >
                          <div className="flex items-center gap-3">
                            <Truck className="h-5 w-5 text-ink-muted" aria-hidden />
                            <div>
                              <p className="text-sm font-medium">
                                {item.trip.origin} → {item.trip.destination}
                              </p>
                              <p className="text-[13px] text-ink-muted">
                                {item.description} · {item.volume.toFixed(1)} m³ ·{" "}
                                {new Date(item.trip.date).toLocaleDateString("es-AR")} ·{" "}
                                {currency(item.priceShare)}
                              </p>
                              <p className="text-[13px] text-ink-muted">
                                {moneyLine(item)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={item.trip.status as TripStatus} />
                            <span className="rounded-full bg-canvas-line px-3 py-1 text-xs font-medium text-ink-soft">
                              carga{" "}
                              {item.status === "CONFIRMED"
                                ? "confirmada"
                                : item.status === "CANCELLED"
                                  ? "retirada"
                                  : "pendiente"}
                            </span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
