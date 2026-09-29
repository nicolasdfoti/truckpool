import { describe, it, expect, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { signToken, verifyOAuthState } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { LEGACY_DEV_SECRET } from "../lib/env.js";
import type { Role } from "@prisma/client";

const ORIGINAL_SECRET = process.env.JWT_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
});

describe("secreto de sesión", () => {
  it("firma con el JWT_SECRET del entorno", () => {
    process.env.JWT_SECRET = "un-secreto-de-verdad";
    const token = signToken({ id: "u1", role: "ADMIN" as Role });
    const payload = jwt.verify(token, "un-secreto-de-verdad") as jwt.JwtPayload;
    expect(payload.sub).toBe("u1");
    expect(payload.role).toBe("ADMIN");
  });

  it("NO firma con el valor de desarrollo que estaba hardcodeado", () => {
    // regresión: el bug era que el secreto de un `const` de módulo se congelaba
    // antes de que dotenv cargara, y caía siempre en este string
    process.env.JWT_SECRET = "un-secreto-de-verdad";
    const token = signToken({ id: "u1", role: "ADMIN" as Role });
    expect(() => jwt.verify(token, LEGACY_DEV_SECRET)).toThrow();
  });

  it("se relee en cada llamada en vez de congelarse al cargar el módulo", () => {
    // si el secreto estuviera en un `const` de módulo, rotarlo no surtiría efecto
    // en los tokens emitidos después de la rotación
    process.env.JWT_SECRET = "secreto-antes-de-rotar";
    const antes = signToken({ id: "u1", role: "CARRIER" as Role });
    process.env.JWT_SECRET = "secreto-despues-de-rotar";
    const despues = signToken({ id: "u1", role: "CARRIER" as Role });

    expect(() => jwt.verify(antes, "secreto-antes-de-rotar")).not.toThrow();
    expect(() => jwt.verify(despues, "secreto-despues-de-rotar")).not.toThrow();
    expect(() => jwt.verify(despues, "secreto-antes-de-rotar")).toThrow();
  });

  it("falla ruidosamente si JWT_SECRET no está definido", () => {
    delete process.env.JWT_SECRET;
    expect(() => signToken({ id: "u1", role: "ADMIN" as Role })).toThrow(
      /JWT_SECRET no está definido/
    );
    // verifyOAuthState envuelve cualquier fallo en un AppError 400
    expect(() => verifyOAuthState("cualquiera")).toThrow(AppError);
  });
});
