/**
 * Envío de emails transaccionales vía Resend (https://resend.com).
 *
 * El envío es best-effort: si la clave no está, si Resend está caído o si la
 * request falla, se loguea y se sigue. Un email que no sale nunca puede
 * romper la operación de negocio que lo disparó.
 */

const RESEND_URL = "https://api.resend.com/emails";

/** los importes en los emails van con el formato argentino, no con "1234.5" */
function formatMoney(value: number): string {
  return value.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "TruckPool <notificaciones@truckpool.app>";
}

/**
 * Encola un email. Nunca lanza: devuelve true si Resend aceptó el envío.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[email] sin RESEND_API_KEY, se omite el envío a ${to}: ${subject}`);
    return false;
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress(), to: [to], subject, html }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Resend respondió ${res.status} para ${to}: ${detail}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[email] no se pudo enviar a ${to}:`, err);
    return false;
  }
}

/**
 * Igual que sendEmail pero respetando la preferencia de la persona: si apagó
 * las notificaciones por email, no se manda nada.
 */
export async function sendEmailToUser(
  user: { email: string; emailNotifications: boolean } | null | undefined,
  subject: string,
  html: string
): Promise<boolean> {
  if (!user) return false;
  if (!user.emailNotifications) {
    console.log(
      `[email] ${user.email} tiene las notificaciones apagadas: se omite "${subject}"`
    );
    return false;
  }
  return sendEmail(user.email, subject, html);
}

type EmailContent = {
  greeting: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  closing?: string;
};

/** layout mínimo, en el mismo tono de marca que el producto: minúsculas y directo */
export function renderEmail({
  greeting,
  paragraphs,
  cta,
  closing,
}: EmailContent): string {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#0b3d5c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${cta.label}</a></p>`
    : "";
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 12px">${text}</p>`)
    .join("");
  const footer = closing ?? "gracias por usar truckpool.";

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#eaf1f7;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1a2733">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e6ea;border-radius:10px;padding:28px">
      <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#0b3d5c">truckpool</p>
      <p style="margin:0 0 16px">${greeting}</p>
      ${body}
      ${button}
      <p style="margin:24px 0 0;font-size:13px;color:#8a94a0">${footer}</p>
    </div>
  </body>
</html>`;
}

export function tripUrl(tripId: string): string {
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  return `${appUrl}/viajes/${tripId}`;
}

/** el nombre de quien recibe: los builders personalize el saludo */
export type EmailRecipient = { name: string };

/** una empresa sumó carga a tu viaje */
export function cargoAddedEmail(input: {
  carrier: EmailRecipient;
  trip: { id: string; origin: string; destination: string };
  description: string;
  volume: number;
  remaining: number;
  capacityTotal: number;
}): { subject: string; html: string } {
  return {
    subject: `nueva carga en tu viaje ${input.trip.origin} → ${input.trip.destination}`,
    html: renderEmail({
      greeting: `hola ${input.carrier.name},`,
      paragraphs: [
        `una empresa sumó ${input.description.toLowerCase()} (${input.volume} m³) a tu viaje ${input.trip.origin} → ${input.trip.destination}.`,
        `te quedan ${input.remaining} m³ libres de ${input.capacityTotal} m³.`,
      ],
      cta: { label: "ver el viaje", url: tripUrl(input.trip.id) },
    }),
  };
}

/** se confirmó una carga que habías agregado */
export function cargoConfirmedEmail(input: {
  company: EmailRecipient;
  trip: { id: string; origin: string; destination: string; carrierName: string };
  description: string;
  volume: number;
}): { subject: string; html: string } {
  return {
    subject: `tu carga está confirmada: ${input.trip.origin} → ${input.trip.destination}`,
    html: renderEmail({
      greeting: `hola ${input.company.name},`,
      paragraphs: [
        `confirmamos ${input.description.toLowerCase()} (${input.volume} m³) en el viaje ${input.trip.origin} → ${input.trip.destination} con ${input.trip.carrierName}.`,
        "ya podés hacer seguimiento del viaje desde el detalle.",
      ],
      cta: { label: "ver el viaje", url: tripUrl(input.trip.id) },
    }),
  };
}

/** una empresa retiró una carga que había sumado a tu viaje */
export function cargoCancelledEmail(input: {
  carrier: EmailRecipient;
  trip: { id: string; origin: string; destination: string };
  companyName: string;
  description: string;
  volume: number;
  remaining: number;
  capacityTotal: number;
  refundedAmount: number;
  feeAmount: number;
  window: string;
}): { subject: string; html: string } {
  // el Transportista ve la plata: es a él a quien le cambia el número si lo que
  // se devuelve no cubre la seña.
  const money =
    input.refundedAmount > 0
      ? `de la seña se devolvieron $${formatMoney(input.refundedAmount)} y quedaron $${formatMoney(
          input.feeAmount
        )} de costo de cancelación.`
      : input.feeAmount > 0
        ? `no se devuelve nada: la seña ($${formatMoney(
            input.feeAmount
          )}) queda como costo de cancelación porque el viaje sale en menos de 24hs.`
        : "la carga no estaba pagada, así que no había nada que devolver.";

  return {
    subject: `una carga se retiró de tu viaje ${input.trip.origin} → ${input.trip.destination}`,
    html: renderEmail({
      greeting: `hola ${input.carrier.name},`,
      paragraphs: [
        `${input.companyName} retiró ${input.description.toLowerCase()} (${input.volume} m³) del viaje ${input.trip.origin} → ${input.trip.destination}.`,
        money,
        `ahora tenés ${input.remaining} m³ libres de ${input.capacityTotal} m³.`,
      ],
      cta: { label: "ver el viaje", url: tripUrl(input.trip.id) },
    }),
  };
}

/** el viaje arrancó: la empresa tiene que pagar el saldo de sus cargas */
export function balanceDueEmail(input: {
  company: EmailRecipient;
  trip: { id: string; origin: string; destination: string; carrierName: string };
  /** una empresa puede tener varias cargas en el mismo viaje: va el total */
  balanceAmount: number;
  priceShare: number;
  depositAmount: number;
  descriptions: string[];
}): { subject: string; html: string } {
  const { trip } = input;
  // "tu carga" en singular mentiría si la empresa tiene dos cargas en el viaje.
  const subject =
    input.descriptions.length > 1
      ? `faltan pagar los saldos de tus cargas: ${trip.origin} → ${trip.destination}`
      : `falta pagar el saldo de tu carga: ${trip.origin} → ${trip.destination}`;
  const detail =
    input.descriptions.length > 1
      ? `tus cargas (${input.descriptions.map((d) => d.toLowerCase()).join(", ")}) van en camino y ya abonaste las señas ($${formatMoney(
          input.depositAmount
        )}), así que solo faltan los saldos de $${formatMoney(
          input.balanceAmount
        )} para cerrar los $${formatMoney(input.priceShare)} del viaje.`
      : `tu carga va en camino y ya abonaste la seña ($${formatMoney(
          input.depositAmount
        )}), así que solo falta el saldo de $${formatMoney(
          input.balanceAmount
        )} para cerrar los $${formatMoney(input.priceShare)} del viaje.`;

  return {
    subject,
    html: renderEmail({
      greeting: `hola ${input.company.name},`,
      paragraphs: [
        `${trip.carrierName} salió con ${trip.origin} → ${trip.destination}.`,
        detail,
        "entrás al viaje y lo pagás con Mercado Pago.",
      ],
      cta: { label: "pagar el saldo", url: tripUrl(trip.id) },
    }),
  };
}

/** el viaje pasó a IN_TRANSIT o a COMPLETED */
export function tripStatusEmail(input: {
  company: EmailRecipient;
  trip: { id: string; origin: string; destination: string; carrierName: string };
  status: "IN_TRANSIT" | "COMPLETED";
  cargoDescription: string;
}): { subject: string; html: string } {
  const { trip, status } = input;
  const subject =
    status === "IN_TRANSIT"
      ? `tu viaje va en camino: ${trip.origin} → ${trip.destination}`
      : `tu viaje se completó: ${trip.origin} → ${trip.destination}`;

  const paragraphs =
    status === "IN_TRANSIT"
      ? [
          `${trip.carrierName} salió con ${trip.origin} → ${trip.destination}, donde va tu carga ${input.cargoDescription.toLowerCase()}.`,
          "te avisamos apenas el viaje se complete.",
        ]
      : [
          `${trip.origin} → ${trip.destination} se completó con ${trip.carrierName}.`,
          `tu carga ${input.cargoDescription.toLowerCase()} llegó a destino.`,
          "cuando puedas, dejá tu calificación del viaje: ayuda a los demás a elegir mejor.",
        ];

  return {
    subject,
    html: renderEmail({
      greeting: `hola ${input.company.name},`,
      paragraphs,
      cta: { label: "ver el viaje", url: tripUrl(trip.id) },
    }),
  };
}
