import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cargoAddedEmail,
  cargoCancelledEmail,
  cargoConfirmedEmail,
  renderEmail,
  sendEmail,
  sendEmailToUser,
  tripRequestEmail,
  tripRequestResponseEmail,
  tripStatusEmail,
} from "../lib/email.js";

const fetchMock = vi.fn();

function okResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => '{"id":"e1"}',
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okResponse());
  vi.stubGlobal("fetch", fetchMock);
  process.env.RESEND_API_KEY = "re_test_123";
  process.env.EMAIL_FROM = "TruckPool <notificaciones@truckpool.app>";
  process.env.APP_URL = "http://localhost:5173";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sentPayload(index = 0) {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`no se llamó fetch en la llamada ${index}`);
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe("sendEmail", () => {
  it("manda el payload a Resend", async () => {
    const ok = await sendEmail("flete@truckpool.app", "hola", "<p>hola</p>");

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const first = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(first[0]).toBe("https://api.resend.com/emails");
    const init = first[1];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_test_123"
    );
    expect(sentPayload()).toEqual({
      from: "TruckPool <notificaciones@truckpool.app>",
      to: ["flete@truckpool.app"],
      subject: "hola",
      html: "<p>hola</p>",
    });
  });

  it("no lanza si Resend responde con error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "invalid",
    } as unknown as Response);

    await expect(sendEmail("a@b.com", "s", "<p>x</p>")).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("no lanza si la request explota", async () => {
    fetchMock.mockRejectedValue(new Error("sin red"));

    await expect(sendEmail("a@b.com", "s", "<p>x</p>")).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("omite el envío si no hay RESEND_API_KEY", async () => {
    delete process.env.RESEND_API_KEY;

    await expect(sendEmail("a@b.com", "s", "<p>x</p>")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// L5 (U6): los logs del email no llevan el destinatario, el asunto (trae
// nombres y rutas) ni la respuesta de Resend, que repite el email
describe("logs del envío sin datos personales", () => {
  function logged(): string {
    const spies = [console.log, console.warn, console.error] as unknown as {
      mock: { calls: unknown[][] };
    }[];
    return spies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
  }

  it("sin RESEND_API_KEY no loguea el destinatario ni el asunto", async () => {
    delete process.env.RESEND_API_KEY;

    await sendEmail("privado@empresa.com", "tu carga Córdoba → Rosario", "<p>x</p>");

    expect(console.warn).toHaveBeenCalled();
    expect(logged()).not.toContain("privado@empresa.com");
    expect(logged()).not.toContain("Córdoba");
  });

  it("si Resend responde con error loguea solo el status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"message":"invalid `to`: privado@empresa.com"}',
    } as unknown as Response);

    await sendEmail("privado@empresa.com", "asunto", "<p>x</p>");

    expect(console.error).toHaveBeenCalledWith("[email] Resend rechazó el envío", {
      status: 422,
    });
    expect(logged()).not.toContain("privado@empresa.com");
  });

  it("si la request explota loguea solo name y code", async () => {
    const err = Object.assign(
      new Error("connect ECONNREFUSED, Authorization: Bearer re_test_123"),
      { code: "ECONNREFUSED" }
    );
    fetchMock.mockRejectedValue(err);

    await sendEmail("privado@empresa.com", "asunto", "<p>x</p>");

    expect(console.error).toHaveBeenCalledWith("[email] no se pudo enviar", {
      name: "Error",
      code: "ECONNREFUSED",
    });
    expect(logged()).not.toContain("privado@empresa.com");
    expect(logged()).not.toContain("re_test_123");
  });

  it("con las notificaciones apagadas no loguea el email", async () => {
    await sendEmailToUser(
      { email: "privado@empresa.com", emailNotifications: false },
      "asunto",
      "<p>x</p>"
    );

    expect(logged()).not.toContain("privado@empresa.com");
  });
});

describe("sendEmailToUser", () => {
  it("manda si la persona tiene las notificaciones prendidas", async () => {
    const ok = await sendEmailToUser(
      { email: "a@b.com", emailNotifications: true },
      "s",
      "<p>x</p>"
    );
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no manda si la persona las apagó", async () => {
    const ok = await sendEmailToUser(
      { email: "a@b.com", emailNotifications: false },
      "s",
      "<p>x</p>"
    );
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no manda si no hay destinatario", async () => {
    await expect(sendEmailToUser(null, "s", "<p>x</p>")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("plantillas de los eventos del flujo", () => {
  // Los builders ya no envían: arman {subject, html} y el envío (y la
  // preferencia) los hace lib/notifications.ts. Acá se prueba el contenido.
  const carrier = { name: "Transportes Flete" };
  const company = { name: "Empresa Uno" };

  /** manda el contenido por el mismo camino que notifyUsers y lee el payload */
  async function send(input: Parameters<typeof sendEmailToUser>) {
    return sendEmailToUser(input[0], input[1], input[2]);
  }

  it("cargoAddedEmail avisa qué se sumó y cuánto queda libre", async () => {
    const { subject, html } = cargoAddedEmail({
      carrier,
      trip: { id: "t1", origin: "Córdoba", destination: "Rosario" },
      description: "Maquinaria",
      volume: 10,
      remaining: 8,
      capacityTotal: 30,
    });
    expect(subject).toBe("nueva carga en tu viaje Córdoba → Rosario");
    expect(html).toContain("maquinaria (10 m³)");
    expect(html).toContain("te quedan 8 m³ libres de 30 m³");
    expect(html).toContain("http://localhost:5173/viajes/t1");
    expect(html).toContain("hola Transportes Flete,");
  });

  it("cargoConfirmedEmail avisa a la empresa que se confirmó", () => {
    const { subject, html } = cargoConfirmedEmail({
      company,
      trip: { id: "t1", origin: "Córdoba", destination: "Rosario", carrierName: "Flete" },
      description: "Maquinaria",
      volume: 10,
    });
    expect(subject).toBe("tu carga está confirmada: Córdoba → Rosario");
    expect(html).toContain("confirmamos maquinaria (10 m³)");
    expect(html).toContain("con Flete");
  });

  it("tripStatusEmail en IN_TRANSIT avisa que va en camino", () => {
    const { subject, html } = tripStatusEmail({
      company,
      trip: { id: "t1", origin: "Córdoba", destination: "Rosario", carrierName: "Flete" },
      status: "IN_TRANSIT",
      cargoDescription: "Maquinaria",
    });
    expect(subject).toBe("tu viaje va en camino: Córdoba → Rosario");
    expect(html).toContain("Flete salió con Córdoba → Rosario");
  });

  it("tripStatusEmail en COMPLETED avisa que terminó", () => {
    const { subject, html } = tripStatusEmail({
      company,
      trip: { id: "t1", origin: "Córdoba", destination: "Rosario", carrierName: "Flete" },
      status: "COMPLETED",
      cargoDescription: "Maquinaria",
    });
    expect(subject).toBe("tu viaje se completó: Córdoba → Rosario");
    expect(html).toContain("llegó a destino");
    expect(html).toContain("calificación");
  });

  it("respeta la preferencia del usuario en las plantillas", async () => {
    const { subject, html } = cargoAddedEmail({
      carrier,
      trip: { id: "t1", origin: "Córdoba", destination: "Rosario" },
      description: "Maquinaria",
      volume: 10,
      remaining: 8,
      capacityTotal: 30,
    });

    await send([{ email: "a@b.com", emailNotifications: false }, subject, html]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// L5 (02§2.4, 02T10): todo lo que se interpola en un email es texto, nunca HTML.
// Una empresa registrada como «<a href=…>verificá tu cuenta</a>» mandaba
// phishing con remitente truckpool.
const PHISHING = '<a href="https://phish.example">verificá tu cuenta MP</a>';
const PHISHING_ESCAPADO =
  "&lt;a href=&quot;https://phish.example&quot;&gt;verificá tu cuenta MP&lt;/a&gt;";
const IMG = "<img src=x onerror=alert(1)>";
const IMG_ESCAPADO = "&lt;img src=x onerror=alert(1)&gt;";

describe("escapado del HTML de los emails", () => {
  it("renderEmail escapa el saludo, los párrafos, el botón y el cierre", () => {
    const html = renderEmail({
      greeting: `hola ${PHISHING},`,
      paragraphs: [`retiraste ${IMG}`, "comillas ' y \" y &"],
      cta: { label: `ver <b>el</b> viaje`, url: 'https://app.example/viajes/1?a="x"' },
      closing: `chau ${IMG}`,
    });

    expect(html).toContain(`hola ${PHISHING_ESCAPADO},`);
    expect(html).toContain(`retiraste ${IMG_ESCAPADO}`);
    expect(html).toContain("comillas &#39; y &quot; y &amp;");
    expect(html).toContain("ver &lt;b&gt;el&lt;/b&gt; viaje");
    expect(html).toContain('href="https://app.example/viajes/1?a=&quot;x&quot;"');
    expect(html).toContain(`chau ${IMG_ESCAPADO}`);
    expect(html).not.toContain("<img");
    expect(html).not.toContain('phish.example"');
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "no es una url"])(
    "un botón con url %j no se renderiza",
    (url) => {
      const html = renderEmail({
        greeting: "hola",
        paragraphs: [],
        cta: { label: "ir", url },
      });
      expect(html).not.toContain("<a ");
    }
  );

  it("los builders pasan texto y el escapado no se duplica", () => {
    const { html } = cargoAddedEmail({
      carrier: { name: PHISHING },
      trip: { id: "t1", origin: "Córdoba", destination: "Rosario" },
      description: "Tornillos & tuercas <img>",
      volume: 4,
      remaining: 10,
      capacityTotal: 30,
    });

    expect(html).toContain(`hola ${PHISHING_ESCAPADO},`);
    expect(html).toContain("tornillos &amp; tuercas &lt;img&gt;");
    expect(html).not.toContain("&amp;amp;");
    expect(html).not.toContain(PHISHING);
  });

  it("cargoCancelledEmail escapa el nombre de la empresa", () => {
    const { html } = cargoCancelledEmail({
      carrier: { name: "Flete" },
      trip: { id: "t1", origin: "Córdoba", destination: "Rosario" },
      companyName: PHISHING,
      description: "cajas",
      volume: 2,
      remaining: 10,
      capacityTotal: 30,
      refundedAmount: 0,
      feeAmount: 0,
      window: "FULL_REFUND",
    });

    expect(html).toContain(PHISHING_ESCAPADO);
    expect(html).not.toContain(PHISHING);
  });
});

describe("emails de solicitudes de viaje", () => {
  const solicitud = {
    carrier: { name: "Transportes Flete" },
    companyName: PHISHING,
    origin: "Córdoba",
    destination: `Rosario ${IMG}`,
    // 13/11/2026 al mediodía ART: el día se muestra en hora argentina
    desiredDate: new Date("2026-11-13T15:00:00.000Z"),
    estimatedVolume: 10,
    note: `traer zorra ${IMG}`,
  };

  it("tripRequestEmail escapa la empresa, el destino y la nota", () => {
    const { subject, html } = tripRequestEmail(solicitud);

    expect(subject).toBe(`nueva solicitud de viaje: Córdoba → Rosario ${IMG}`);
    expect(html).toContain(PHISHING_ESCAPADO);
    expect(html).toContain(`Rosario ${IMG_ESCAPADO}`);
    expect(html).toContain(`traer zorra ${IMG_ESCAPADO}`);
    expect(html).toContain("viernes, 13 de noviembre");
    expect(html).toContain('href="http://localhost:5173/solicitudes"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain(PHISHING);
  });

  it("tripRequestEmail sin nota no muestra la línea de la nota", () => {
    const { html } = tripRequestEmail({ ...solicitud, note: null });
    expect(html).not.toContain("nota");
  });

  it("tripRequestResponseEmail aceptada escapa el fletero y linkea al viaje", () => {
    const { subject, html } = tripRequestResponseEmail({
      company: { name: "Acero SA" },
      carrierName: PHISHING,
      origin: "Córdoba",
      destination: "Rosario",
      accepted: true,
      tripId: "t9",
    });

    expect(subject).toBe("tu solicitud fue aceptada: Córdoba → Rosario");
    expect(html).toContain(PHISHING_ESCAPADO);
    expect(html).toContain('href="http://localhost:5173/viajes/t9"');
    expect(html).not.toContain("undefined");
  });

  it("tripRequestResponseEmail rechazada no lleva link al viaje", () => {
    const { subject, html } = tripRequestResponseEmail({
      company: { name: "Acero SA" },
      carrierName: "Flete",
      origin: "Córdoba",
      destination: "Rosario",
      accepted: false,
      tripId: null,
    });

    expect(subject).toBe("tu solicitud fue rechazada: Córdoba → Rosario");
    expect(html).not.toContain("/viajes/");
  });
});
