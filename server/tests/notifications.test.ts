import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { sendEmailToUser } from "../lib/email.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../modules/notifications/notifications.service.js";

vi.mock("../lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    notification: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// el email se mockea entero: lo que se prueba acá es que notifyUsers lo
// despacha (o no) según emailNotifications, no que Resend funcione.
vi.mock("../lib/email", () => ({
  sendEmail: vi.fn(),
  sendEmailToUser: vi.fn(),
  renderEmail: vi.fn(() => "<p>html</p>"),
  tripUrl: vi.fn((id: string) => `http://localhost:5173/viajes/${id}`),
}));

const { notifyUsers } = await import("../lib/notifications.js");

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "Empresa Uno",
    email: "uno@empresa.com",
    emailNotifications: true,
    ...overrides,
  };
}

const aviso = {
  type: "CARGO_ADDED" as const,
  title: "nueva carga",
  body: "sumó maquinaria",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("notifyUsers", () => {
  it("crea una Notification por cada userId", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      user({ id: "u1" }),
      user({ id: "u2", name: "Empresa Dos", email: "dos@empresa.com" }),
    ] as never);
    vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 2 } as never);

    const count = await notifyUsers(["u1", "u2"], { ...aviso, tripId: "t1" });

    expect(count).toBe(2);
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "u1",
          type: "CARGO_ADDED",
          title: "nueva carga",
          body: "sumó maquinaria",
          tripId: "t1",
        },
        {
          userId: "u2",
          type: "CARGO_ADDED",
          title: "nueva carga",
          body: "sumó maquinaria",
          tripId: "t1",
        },
      ],
    });
  });

  it("no duplica si el mismo userId viene dos veces", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([user()] as never);
    vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 1 } as never);

    const count = await notifyUsers(["u1", "u1", "u1"], aviso);

    expect(count).toBe(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["u1"] } } })
    );
  });

  it("no crea nada sin destinatarios", async () => {
    expect(await notifyUsers([], aviso)).toBe(0);
    expect(await notifyUsers(["", "  "], aviso)).toBe(0);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it("ignora los userIds que no existen en la base", async () => {
    // el usuario se borró entre que se armó la lista y se guardó el aviso: la
    // FK no debe reventar la operación.
    vi.mocked(prisma.user.findMany).mockResolvedValue([user({ id: "u1" })] as never);
    vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 1 } as never);

    const count = await notifyUsers(["u1", "fantasma"], aviso);

    expect(count).toBe(1);
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: "u1" })],
    });
  });

  describe("email como canal opcional", () => {
    it("manda email a los que lo tienen prendido", async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        user({ id: "u1" }),
        user({ id: "u2", name: "Empresa Dos", email: "dos@empresa.com" }),
      ] as never);
      vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 2 } as never);
      vi.mocked(sendEmailToUser).mockResolvedValue(true);

      await notifyUsers(["u1", "u2"], { ...aviso, tripId: "t1" });
      // el envío es fire-and-forget: se despacha pero no se espera
      await vi.waitFor(() => expect(sendEmailToUser).toHaveBeenCalledTimes(2));

      expect(sendEmailToUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: "uno@empresa.com", emailNotifications: true }),
        "nueva carga",
        "<p>html</p>"
      );
    });

    it("respeta emailNotifications=false: crea la in-app y no manda email", async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        user({ id: "u1", emailNotifications: false }),
      ] as never);
      vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 1 } as never);

      const count = await notifyUsers(["u1"], aviso);

      // el aviso in-app existe igual: la preferencia es solo del canal email
      expect(count).toBe(1);
      expect(prisma.notification.createMany).toHaveBeenCalled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(sendEmailToUser).not.toHaveBeenCalled();
    });

    it("usa el email a medida cuando el aviso lo trae", async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([user()] as never);
      vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(sendEmailToUser).mockResolvedValue(true);

      await notifyUsers(["u1"], {
        ...aviso,
        email: (recipient) => ({
          subject: `para ${recipient.name}`,
          html: "<p>contexto</p>",
        }),
      });
      await vi.waitFor(() =>
        expect(sendEmailToUser).toHaveBeenCalledWith(
          expect.anything(),
          "para Empresa Uno",
          "<p>contexto</p>"
        )
      );
    });

    it("un email que explota no rompe la creación de la in-app", async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([user()] as never);
      vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(sendEmailToUser).mockResolvedValue(false);

      // el builder del email es lo más frágil que hay (armar strings con datos
      // del dominio): si explota, el aviso in-app ya está creado.
      await expect(
        notifyUsers(["u1"], {
          ...aviso,
          email: () => {
            throw new Error("se rompió el builder");
          },
        })
      ).resolves.toBe(1);
      await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    });
  });
});

describe("listNotifications", () => {
  beforeEach(() => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([
      {
        id: "n1",
        type: "MESSAGE",
        title: "te escribió",
        body: "hola",
        tripId: "t1",
        read: false,
        createdAt: new Date("2026-09-27T10:00:00Z"),
      },
    ] as never);
  });

  it("lista las del usuario, más recientes primero", async () => {
    const result = await listNotifications("u1");

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    expect(result).toEqual([
      {
        id: "n1",
        type: "MESSAGE",
        title: "te escribió",
        body: "hola",
        tripId: "t1",
        read: false,
        createdAt: "2026-09-27T10:00:00.000Z",
      },
    ]);
  });

  it("con unreadOnly filtra por las no leídas", async () => {
    await listNotifications("u1", { unreadOnly: true });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", read: false } })
    );
  });
});

describe("marcar como leída", () => {
  it("marca una notificación propia", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 } as never);

    const result = await markNotificationRead("n1", "u1");

    // el userId va en el where: marcar la de otro no puede ser un 403 que
    // confirme que ese id existe, tiene que ser un no-op
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: "u1" },
      data: { read: true },
    });
    expect(result).toEqual({ updated: true });
  });

  it("no marca la notificación de otra persona", async () => {
    // updateMany con el filtro del userId: 0 filas, sin tocar nada
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await markNotificationRead("n1", "otra");

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: "otra" },
      data: { read: true },
    });
    expect(result).toEqual({ updated: false });
  });

  it("read-all solo toca las no leídas del usuario", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 3 } as never);

    const result = await markAllNotificationsRead("u1");

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", read: false },
      data: { read: true },
    });
    expect(result).toEqual({ updated: 3 });
  });
});
