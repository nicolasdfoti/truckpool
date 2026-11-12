import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runDemoSeed } from "../prisma/demo-seed.js";
import { assertNotProduction } from "../prisma/seed-guard.js";

// El seed demo crea usuarios con la contraseña pública truckpool123 (U14):
// con NODE_ENV=production no puede escribir nada. Prisma va como un doble a
// mano: el seed recibe la base por parámetro.

function fakeDb() {
  const user = (email: string, role: string) => ({
    id: `id-${email}`,
    email,
    role,
    verificationStatus: role === "CARRIER" ? "VERIFIED" : "NONE",
  });
  return {
    user: {
      upsert: vi.fn(
        async (args: { where: { email: string }; create: { role: string } }) =>
          user(args.where.email, args.create.role)
      ),
    },
    // con viajes ya cargados el seed no crea los de ejemplo
    trip: { count: vi.fn(async () => 1), create: vi.fn() },
    cargoItem: { create: vi.fn() },
    payment: { create: vi.fn() },
  };
}

const nodeEnvOriginal = process.env.NODE_ENV;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.env.NODE_ENV = nodeEnvOriginal;
  logSpy.mockRestore();
});

describe("seed demo", () => {
  it("con NODE_ENV=production lanza sin tocar la base", async () => {
    process.env.NODE_ENV = "production";
    const db = fakeDb();

    await expect(runDemoSeed(db as unknown as PrismaClient)).rejects.toThrow(
      "seed-demo no corre con NODE_ENV=production"
    );

    expect(db.user.upsert).not.toHaveBeenCalled();
    expect(db.trip.count).not.toHaveBeenCalled();
    expect(db.trip.create).not.toHaveBeenCalled();
  });

  it("en development crea los usuarios demo", async () => {
    process.env.NODE_ENV = "development";
    const db = fakeDb();

    await runDemoSeed(db as unknown as PrismaClient);

    const emails = db.user.upsert.mock.calls.map((call) => call[0].where.email);
    expect(emails).toEqual([
      "flete@truckpool.app",
      "admin@truckpool.app",
      "empresa@truckpool.app",
    ]);
  });
});

describe("assertNotProduction", () => {
  it("lanza con NODE_ENV=production y nombra el script", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertNotProduction("seed-e2e")).toThrow(
      "seed-e2e no corre con NODE_ENV=production"
    );
  });

  it("deja pasar fuera de producción", () => {
    process.env.NODE_ENV = "development";
    expect(() => assertNotProduction("seed-e2e")).not.toThrow();
  });
});
