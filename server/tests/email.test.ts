import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cargoAddedEmail,
  cargoConfirmedEmail,
  sendEmail,
  sendEmailToUser,
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
