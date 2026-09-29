import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { app } from "../src/app.js";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

// el test del login exitoso necesita que la contraseña "matchee"
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn<(a: string, b: string) => Promise<boolean>>().mockResolvedValue(true),
  },
}));

// bcryptjs declara compare con dos sobrecargas y la última devuelve void:
// para poder darle mockResolvedValue hay que quedarse con la que promete
// Promise<boolean>.
type CompareFn = (password: string, hash: string) => Promise<boolean>;
const compareMock = () => vi.mocked(bcrypt.compare as CompareFn);

const verifiedUser = {
  id: "u1",
  email: "flete@truckpool.app",
  name: "Transportes Flete",
  role: "CARRIER" as const,
  password: "$2b$10$hash",
  bio: null,
  phone: null,
  taxId: "20345678901",
  verificationStatus: "VERIFIED" as const,
  verificationNote: null,
  emailNotifications: true,
  isAvailableNow: true,
  mpUserId: "mp-user-123",
  mpAccessToken: "access-token-123",
  createdAt: new Date(),
};

// El rate limit se crea al importar el app, así que el helper `freshApp`
// recarga los módulos con la variable de entorno que necesita cada caso.
vi.mock("../lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    cargoItem: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

beforeEach(() => {
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  compareMock().mockResolvedValue(false);
});

afterEach(() => {
  delete process.env.AUTH_RATE_LIMIT_MAX;
  vi.resetModules();
});

describe("headers de seguridad (helmet)", () => {
  it("X-Powered-By no se filtra", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("la CSP prohibe cargar cualquier recurso desde la respuesta de la API", async () => {
    const res = await request(app).get("/health");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it("no se puede embeber en un iframe (X-Frame-Options: DENY)", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("no confia en el content-type declarado (X-Content-Type-Options)", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("no manda el Referer a terceros", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("sin HSTS en desarrollo (rompería el server http de localhost)", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });

  it("deja leer el manifiesto PDF desde el cliente (que es otro origen)", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });

  it("los headers de seguridad no rompen CORS: el preflight sigue pasando", async () => {
    const res = await request(app)
      .options("/api/auth/login")
      .set("Origin", "http://localhost:5175")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5175");
  });
});

describe("GET /health", () => {
  it("responde ok sin tocar la base (200)", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("también existe bajo el prefijo de la API", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("no exige token", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });
});

/** Recarga el app con la variable de entorno indicada. */
async function freshApp(env: Record<string, string>): Promise<Express> {
  Object.assign(process.env, env);
  vi.resetModules();
  const { app: fresh } = await import("../src/app.js");
  return fresh;
}

describe("rate limit en /api/auth", () => {
  const login = (app: Express) =>
    request(app)
      .post("/api/auth/login")
      .send({ email: "no@existe.test", password: "malaclave" });
  const register = (app: Express) =>
    request(app).post("/api/auth/register").send({ email: "no@existe.test" });

  it("sin límite prendido en los tests: 12 logins seguidos no dan 429", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await login(app);
      expect(res.status).toBe(401);
    }
  });

  it("corta el login después del máximo de intentos (429)", async () => {
    const limited = await freshApp({ AUTH_RATE_LIMIT_MAX: "3" });

    for (let i = 0; i < 3; i++) {
      expect((await login(limited)).status).toBe(401);
    }
    const blocked = await login(limited);

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect(blocked.body.error).toMatch(/15 minutos/);
  });

  it("el header RateLimit dice cuánto falta para reintentar", async () => {
    const limited = await freshApp({ AUTH_RATE_LIMIT_MAX: "1" });
    await login(limited);
    const blocked = await login(limited);

    expect(blocked.status).toBe(429);
    // draft-7: un header RateLimit con el presupuesto y un Retry-After
    expect(blocked.headers["ratelimit"]).toContain("limit=1");
    expect(blocked.headers["ratelimit"]).toContain("remaining=0");
    expect(blocked.headers["retry-after"]).toBe("900");
  });

  it("corta el registro por separado del login", async () => {
    const limited = await freshApp({ AUTH_RATE_LIMIT_MAX: "2" });

    for (let i = 0; i < 2; i++) {
      await register(limited);
    }
    const blocked = await register(limited);

    expect(blocked.status).toBe(429);
    // el login tiene su propio presupuesto: un registro fallado no te deja
    // entrar a tu propia cuenta
    expect((await login(limited)).status).toBe(401);
  });

  it("el login que ACIERTA no gasta presupuesto (usuario legítimo entra y sale)", async () => {
    const limited = await freshApp({ AUTH_RATE_LIMIT_MAX: "2" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(verifiedUser);
    compareMock().mockResolvedValue(true);

    for (let i = 0; i < 5; i++) {
      const res = await request(limited)
        .post("/api/auth/login")
        .send({ email: "flete@truckpool.app", password: "truckpool123" });
      expect(res.status).toBe(200);
    }
  });

  it("el login que falla sí gasta presupuesto", async () => {
    const limited = await freshApp({ AUTH_RATE_LIMIT_MAX: "2" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(verifiedUser);
    compareMock().mockResolvedValue(false);

    expect(
      (
        await request(limited)
          .post("/api/auth/login")
          .send({ email: "flete@truckpool.app", password: "mal" })
      ).status
    ).toBe(401);
    expect(
      (
        await request(limited)
          .post("/api/auth/login")
          .send({ email: "flete@truckpool.app", password: "mal" })
      ).status
    ).toBe(401);
    expect(
      (
        await request(limited)
          .post("/api/auth/login")
          .send({ email: "flete@truckpool.app", password: "mal" })
      ).status
    ).toBe(429);
  });

  it("cuenta también los requests con body inválido", async () => {
    const limited = await freshApp({ AUTH_RATE_LIMIT_MAX: "1" });

    expect((await register(limited)).status).toBe(400);
    expect((await register(limited)).status).toBe(429);
  });
});
