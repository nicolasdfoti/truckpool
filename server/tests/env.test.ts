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
  NODE_ENV: process.env.NODE_ENV,
};

function restore(key: keyof typeof ORIGINAL) {
  if (ORIGINAL[key] === undefined) delete process.env[key];
  else process.env[key] = ORIGINAL[key];
}

describe("assertServerEnv", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "un-secreto-cualquiera";
    process.env.DATABASE_URL = "postgresql://algo/algo";
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    restore("JWT_SECRET");
    restore("DATABASE_URL");
    restore("NODE_ENV");
  });

  it("no se queja con una configuración completa", () => {
    expect(() => assertServerEnv()).not.toThrow();
  });

  describe("MP_OAUTH_TEST_TOKEN", () => {
    afterEach(() => {
      delete process.env.MP_OAUTH_TEST_TOKEN;
    });

    it("aborta en producción con MP_OAUTH_TEST_TOKEN=true: sandbox nunca en producción", () => {
      process.env.NODE_ENV = "production";
      process.env.MP_OAUTH_TEST_TOKEN = "true";
      expect(() => assertServerEnv()).toThrow(EnvError);
      expect(() => assertServerEnv()).toThrow(/MP_OAUTH_TEST_TOKEN/);
    });

    it.each([["false"], [""], [undefined]])(
      "arranca en producción con MP_OAUTH_TEST_TOKEN=%j",
      (valor) => {
        process.env.NODE_ENV = "production";
        if (valor === undefined) delete process.env.MP_OAUTH_TEST_TOKEN;
        else process.env.MP_OAUTH_TEST_TOKEN = valor;
        expect(() => assertServerEnv()).not.toThrow();
      }
    );

    it("arranca en development con MP_OAUTH_TEST_TOKEN=true", () => {
      process.env.MP_OAUTH_TEST_TOKEN = "true";
      expect(() => assertServerEnv()).not.toThrow();
    });

    it("aborta con un valor desconocido: un typo no elige el modo en silencio", () => {
      process.env.MP_OAUTH_TEST_TOKEN = "1";
      expect(() => assertServerEnv()).toThrow(/MP_OAUTH_TEST_TOKEN="1" no es válido/);
    });
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

  it("aborta si NODE_ENV no está definido (se montarían los diagnósticos de pagos)", () => {
    delete process.env.NODE_ENV;
    expect(() => assertServerEnv()).toThrow(EnvError);
    expect(() => assertServerEnv()).toThrow(/NODE_ENV no está definido/);
  });

  it("aborta si NODE_ENV es un valor desconocido como 'prod'", () => {
    process.env.NODE_ENV = "prod";
    expect(() => assertServerEnv()).toThrow(/NODE_ENV/);
  });

  it.each(["development", "production"])("acepta NODE_ENV=%s", (value) => {
    process.env.NODE_ENV = value;
    expect(() => assertServerEnv()).not.toThrow();
  });

  it("aborta con NODE_ENV=test: es solo para vitest y apaga los rate limits", () => {
    // vitest no pasa por src/index.ts: un server que arranca con "test" es un
    // despliegue mal configurado (sin límite de login y con los diagnósticos de MP)
    process.env.NODE_ENV = "test";
    expect(() => assertServerEnv()).toThrow(/NODE_ENV="test"/);
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
