import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertServerEnv, EnvError, LEGACY_DEV_SECRET } from "../lib/env.js";

/**
 * Estos tests mueven process.env, así que guardan y restauran lo que tocan:
 * el resto de la suite corre en el mismo proceso y no puede quedar con un
 * entorno a medio camino.
 */
const ORIGINAL = {
  JWT_SECRET: process.env.JWT_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
};

function restore(key: "JWT_SECRET" | "DATABASE_URL") {
  if (ORIGINAL[key] === undefined) delete process.env[key];
  else process.env[key] = ORIGINAL[key];
}

describe("assertServerEnv", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "un-secreto-cualquiera";
    process.env.DATABASE_URL = "postgresql://algo/algo";
  });

  afterEach(() => {
    restore("JWT_SECRET");
    restore("DATABASE_URL");
  });

  it("no se queja con una configuración completa", () => {
    expect(() => assertServerEnv()).not.toThrow();
  });

  it("aborta si JWT_SECRET no está definido", () => {
    delete process.env.JWT_SECRET;
    expect(() => assertServerEnv()).toThrow(EnvError);
    expect(() => assertServerEnv()).toThrow(/JWT_SECRET no está definido/);
  });

  it("aborta si JWT_SECRET es sólo espacios", () => {
    process.env.JWT_SECRET = "   ";
    expect(() => assertServerEnv()).toThrow(/JWT_SECRET no está definido/);
  });

  it("aborta si JWT_SECRET es un string vacío", () => {
    process.env.JWT_SECRET = "";
    expect(() => assertServerEnv()).toThrow(/JWT_SECRET no está definido/);
  });

  it("aborta si JWT_SECRET es el valor de desarrollo que estaba hardcodeado", () => {
    // el string filtrado importa: vivió en el fuente, así que cualquiera que lo
    // haya leído puede firmar un token de admin
    process.env.JWT_SECRET = LEGACY_DEV_SECRET;
    expect(() => assertServerEnv()).toThrow(/estaba hardcodeado/);
    expect(() => assertServerEnv()).toThrow(/filtrado/);
  });

  it("aborta si falta DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => assertServerEnv()).toThrow(/DATABASE_URL no está definido/);
  });

  it("reporta todos los problemas juntos, no sólo el primero", () => {
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;
    try {
      assertServerEnv();
      expect.unreachable("assertServerEnv tenía que abortar");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      expect((err as EnvError).problems).toHaveLength(2);
    }
  });
});
