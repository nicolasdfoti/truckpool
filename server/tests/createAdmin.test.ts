import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  AdminInputError,
  createAdmin,
} from "../prisma/create-admin-lib.js";

// `npm run admin:create`: el único camino a un ADMIN en producción (U14). La
// lógica recibe la base por parámetro; acá va un doble a mano.

const CLAVE = "una-clave-larga-de-prueba-1234";

function fakeDb(existing: { id: string; role: string } | null = null) {
  return {
    user: {
      findUnique: vi.fn(async () => existing),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "admin-nuevo",
        ...args.data,
      })),
    },
  };
}

const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  for (const method of ["log", "warn", "error", "info"] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  while (consoleSpies.length > 0) consoleSpies.pop()?.mockRestore();
});

function loggedText(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls.flat())
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join("\n");
}

describe("createAdmin", () => {
  it("pide al menos 16 caracteres", async () => {
    expect(ADMIN_PASSWORD_MIN_LENGTH).toBe(16);
    const db = fakeDb();

    await expect(
      createAdmin(
        { email: "admin@empresa.com", password: "a".repeat(15) },
        db as unknown as PrismaClient
      )
    ).rejects.toThrow(AdminInputError);

    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("rechaza un email inválido", async () => {
    const db = fakeDb();

    await expect(
      createAdmin(
        { email: "no-es-un-email", password: CLAVE },
        db as unknown as PrismaClient
      )
    ).rejects.toThrow(AdminInputError);

    expect(db.user.create).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "COMPANY", "CARRIER"])(
    "aborta si el email ya existe (rol %s): no crea, no promueve, no cambia la clave",
    async (role) => {
      const db = fakeDb({ id: "u1", role });

      await expect(
        createAdmin(
          { email: "admin@empresa.com", password: CLAVE },
          db as unknown as PrismaClient
        )
      ).rejects.toThrow("ya existe una cuenta con ese email");

      expect(db.user.create).not.toHaveBeenCalled();
    }
  );

  it("crea el ADMIN con la clave hasheada y nunca la loguea", async () => {
    const db = fakeDb();

    const admin = await createAdmin(
      { email: "  admin@empresa.com ", password: CLAVE },
      db as unknown as PrismaClient
    );

    expect(admin).toEqual({ id: "admin-nuevo", email: "admin@empresa.com" });
    const data = db.user.create.mock.calls[0]![0].data as {
      email: string;
      name: string;
      role: string;
      password: string;
    };
    expect(data.email).toBe("admin@empresa.com");
    expect(data.role).toBe("ADMIN");
    expect(data.name).toBe("Administración TruckPool");
    expect(data.password).not.toBe(CLAVE);
    expect(await bcrypt.compare(CLAVE, data.password)).toBe(true);
    expect(loggedText()).not.toContain(CLAVE);
  });

  it("usa el nombre que se le pasa", async () => {
    const db = fakeDb();

    await createAdmin(
      { email: "admin@empresa.com", password: CLAVE, name: "Soporte" },
      db as unknown as PrismaClient
    );

    expect(db.user.create.mock.calls[0]![0].data.name).toBe("Soporte");
  });
});
