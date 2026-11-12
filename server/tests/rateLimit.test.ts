import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createRateLimit, rateLimitsEnabled } from "../lib/rateLimit.js";

// La fábrica de límites (L5, U15): se prueba sobre una app mínima. Los
// límites montados en cada ruta se prueban en rateLimit.routes.test.ts.

const MINUTO = 60_000;

/** una app con el límite delante; `x-user` hace de sesión */
function appCon(limiter: express.RequestHandler) {
  const app = express();
  app.set("trust proxy", 1);
  app.use((req, _res, next) => {
    const id = req.header("x-user");
    if (id) req.user = { id, role: "COMPANY" };
    next();
  });
  app.get("/", limiter, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

afterEach(() => {
  delete process.env.RATE_LIMITS;
});

describe("rateLimitsEnabled", () => {
  it("con vitest y sin RATE_LIMITS quedan apagados (la suite no da 429)", () => {
    expect(rateLimitsEnabled()).toBe(false);
  });

  it("RATE_LIMITS=on los prende en los tests que los prueban", () => {
    process.env.RATE_LIMITS = "on";
    expect(rateLimitsEnabled()).toBe(true);
  });

  it("RATE_LIMITS=off los apaga", () => {
    process.env.RATE_LIMITS = "off";
    expect(rateLimitsEnabled()).toBe(false);
  });
});

describe("createRateLimit", () => {
  it("apagado deja pasar todo", async () => {
    const app = appCon(
      createRateLimit({ name: "x", windowMs: MINUTO, limit: 1, key: "ip" })
    );
    for (let i = 0; i < 5; i++) expect((await request(app).get("/")).status).toBe(200);
  });

  it("por IP: el pedido N+1 da 429 con el código estable y cuándo reintentar", async () => {
    process.env.RATE_LIMITS = "on";
    const app = appCon(
      createRateLimit({ name: "x", windowMs: 15 * MINUTO, limit: 2, key: "ip" })
    );

    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(200);
    const blocked = await request(app).get("/");

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: "demasiados pedidos. probá de nuevo en 15 minutos.",
      code: "RATE_LIMITED",
    });
    expect(blocked.headers["retry-after"]).toBe("900");
  });

  it("por IP: otra IP tiene su propio contador", async () => {
    process.env.RATE_LIMITS = "on";
    const app = appCon(
      createRateLimit({ name: "x", windowMs: MINUTO, limit: 1, key: "ip" })
    );

    await request(app).get("/").set("X-Forwarded-For", "203.0.113.1");
    const misma = await request(app).get("/").set("X-Forwarded-For", "203.0.113.1");
    const otra = await request(app).get("/").set("X-Forwarded-For", "203.0.113.2");

    expect(misma.status).toBe(429);
    expect(otra.status).toBe(200);
  });

  it("por usuario: cada usuario cuenta aparte, aunque compartan la IP", async () => {
    process.env.RATE_LIMITS = "on";
    const app = appCon(
      createRateLimit({ name: "x", windowMs: MINUTO, limit: 1, key: "user" })
    );

    await request(app).get("/").set("x-user", "u1");
    const mismo = await request(app).get("/").set("x-user", "u1");
    const otro = await request(app).get("/").set("x-user", "u2");

    expect(mismo.status).toBe(429);
    expect(mismo.body.error).toBe("demasiados pedidos. probá de nuevo en 1 minuto.");
    expect(otro.status).toBe(200);
  });

  it("por usuario: cambiar de IP no reinicia el contador", async () => {
    process.env.RATE_LIMITS = "on";
    const app = appCon(
      createRateLimit({ name: "x", windowMs: MINUTO, limit: 1, key: "user" })
    );

    await request(app).get("/").set("x-user", "u1").set("X-Forwarded-For", "203.0.113.1");
    const otraIp = await request(app)
      .get("/")
      .set("x-user", "u1")
      .set("X-Forwarded-For", "203.0.113.9");

    expect(otraIp.status).toBe(429);
  });
});
