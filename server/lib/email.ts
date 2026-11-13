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
    // sin destinatario ni asunto: el asunto trae nombres y rutas (U6)
    console.warn("[email] sin RESEND_API_KEY: se omite el envío");
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
      // solo el status: el body de Resend repite el destinatario (U6)
      console.error("[email] Resend rechazó el envío", { status: res.status });
      return false;
    }

    return true;
  } catch (err) {
    // nunca el error entero: puede traer la request con el Authorization
    console.error("[email] no se pudo enviar", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
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
  if (!user.emailNotifications) return false;
  return sendEmail(user.email, subject, html);
}

type EmailContent = {
  greeting: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  closing?: string;
};

/**
 * Todo lo que va en un email es texto: nombres, descripciones, direcciones y
 * notas los escribe la gente, y una empresa registrada como «<a href=…>» mandaba
 * phishing con remitente truckpool (02§2.4). Se escapa una sola vez, acá: los
 * builders pasan texto plano.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** solo links http(s): un `javascript:` o un `data:` no van nunca en un botón */
function safeLink(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** layout mínimo, en el mismo tono de marca que el producto: minúsculas y directo */
export function renderEmail({
  greeting,
  paragraphs,
  cta,
  closing,
}: EmailContent): string {
  const href = cta ? safeLink(cta.url) : null;
  const button =
    cta && href
      ? `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#0b3d5c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${escapeHtml(cta.label)}</a></p>`
      : "";
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 12px">${escapeHtml(text)}</p>`)
    .join("");
  const footer = escapeHtml(closing ?? "gracias por usar truckpool.");

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#eaf1f7;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1a2733">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e6ea;border-radius:10px;padding:28px">
      <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#0b3d5c">truckpool</p>
      <p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
      ${body}
      ${button}
      <p style="margin:24px 0 0;font-size:13px;color:#8a94a0">${footer}</p>
    </div>
  </body>
</html>`;
}

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:5173";
}

export function tripUrl(tripId: string): string {
  return `${appUrl()}/viajes/${tripId}`;
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

/**
 * L7: el viaje le canceló la carga a la empresa (no la retiró ella): salió sin
 * confirmarla (D3), el fletero lo canceló (D6) o no salió a tiempo (D6
 * automática). Informa una devolución de plata, así que dice qué carga, por qué
 * y cuánto vuelve de la seña, o que no se había cobrado.
 */
export function tripCargoCancelledEmail(input: {
  company: EmailRecipient;
  trip: { id: string; origin: string; destination: string; carrierName: string };
  description: string;
  volume: number;
  reason: "TRIP_DEPARTED" | "CARRIER_CANCELLED" | "NO_DEPARTURE";
  /** la seña cobrada que vuelve entera; 0 si no se había cobrado */
  refundAmount: number;
}): { subject: string; html: string } {
  const { trip } = input;
  const ruta = `${trip.origin} → ${trip.destination}`;
  const carga = `${input.description.toLowerCase()} (${input.volume} m³)`;
  const motivo =
    input.reason === "TRIP_DEPARTED"
      ? `el viaje ${ruta} salió sin que tu carga estuviera confirmada, así que ${carga} no viaja.`
      : input.reason === "CARRIER_CANCELLED"
        ? `${trip.carrierName} canceló el viaje ${ruta}, así que ${carga} no viaja.`
        : `el viaje ${ruta} no salió dentro de las 24 h posteriores a la salida, así que lo cancelamos y ${carga} no viaja.`;
  const plata =
    input.refundAmount > 0
      ? [
          `te devolvemos la seña entera: $${formatMoney(input.refundAmount)}.`,
          "el reembolso lo procesa Mercado Pago y puede tardar unos días en verse en tu medio de pago.",
        ]
      : [
          "no se había cobrado la seña, así que no hay nada que devolver. si se llega a acreditar, te la devolvemos entera.",
        ];

  return {
    subject:
      input.reason === "TRIP_DEPARTED"
        ? `tu carga se canceló: ${ruta}`
        : `se canceló el viaje: ${ruta}`,
    html: renderEmail({
      greeting: `hola ${input.company.name},`,
      paragraphs: [motivo, ...plata],
      cta: { label: "ver el viaje", url: tripUrl(trip.id) },
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

/** una empresa le pidió un viaje directo al fletero */
export function tripRequestEmail(input: {
  carrier: EmailRecipient;
  companyName: string;
  origin: string;
  destination: string;
  desiredDate: Date;
  estimatedVolume: number;
  note?: string | null;
}): { subject: string; html: string } {
  // el día del pedido es un día argentino (se guarda al mediodía ART)
  const date = input.desiredDate.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const paragraphs = [
    `${input.companyName} te pidió un viaje directo: ${input.origin} → ${input.destination}.`,
    `fecha deseada: ${date}. volumen estimado: ${input.estimatedVolume} m³.`,
  ];
  if (input.note) paragraphs.push(`nota de la empresa: ${input.note}`);
  paragraphs.push("entrá para ver la solicitud y responderla.");

  return {
    subject: `nueva solicitud de viaje: ${input.origin} → ${input.destination}`,
    html: renderEmail({
      greeting: `hola ${input.carrier.name},`,
      paragraphs,
      cta: { label: "ver las solicitudes", url: `${appUrl()}/solicitudes` },
    }),
  };
}

/** el fletero aceptó (y publicó el viaje) o rechazó la solicitud de la empresa */
export function tripRequestResponseEmail(input: {
  company: EmailRecipient;
  carrierName: string;
  origin: string;
  destination: string;
  accepted: boolean;
  tripId: string | null;
}): { subject: string; html: string } {
  const route = `${input.origin} → ${input.destination}`;
  const paragraphs = input.accepted
    ? [
        `${input.carrierName} aceptó tu solicitud de viaje ${route} y publicó el viaje.`,
        "ya podés sumar tu carga.",
      ]
    : [`${input.carrierName} no puede hacer el viaje ${route} en este momento.`];

  return {
    subject: input.accepted
      ? `tu solicitud fue aceptada: ${route}`
      : `tu solicitud fue rechazada: ${route}`,
    html: renderEmail({
      greeting: `hola ${input.company.name},`,
      paragraphs,
      ...(input.accepted && input.tripId
        ? { cta: { label: "ver el viaje", url: tripUrl(input.tripId) } }
        : {}),
    }),
  };
}
