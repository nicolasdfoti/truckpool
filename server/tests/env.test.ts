import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertServerEnv, EnvError, jobsStatus, LEGACY_DEV_SECRET } from "../lib/env.js";

/**
 * Estos tests mueven process.env, así que guardan y restauran lo que tocan:
 * el resto de la suite corre en el mismo proceso y no puede quedar con un
 * entorno a medio camino.
 */
const KEYS = [
  "JWT_SECRET",
  "DATABASE_URL",
  "NODE_ENV",
  "APP_URL",
  "API_PUBLIC_URL",
  "TOKEN_ENCRYPTION_KEY",
  "MP_WEBHOOK_SECRET",
  "MP_CLIENT_ID",
  "MP_CLIENT_SECRET",
  "RESEND_API_KEY",
  "CORS_ORIGIN",
  "TRUST_PROXY",
  "RATE_LIMITS",
] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function restoreAll() {
  for (const key of KEYS) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
}

/** lo que exige producción además de lo de siempre (L5, 02§2.6) */
const PROD_COMPLETO = {
  APP_URL: "https://app.truckpool.app",
  API_PUBLIC_URL: "https://api.truckpool.app",
  TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
  MP_WEBHOOK_SECRET: "secreto-del-webhook",
  MP_CLIENT_ID: "client-id",
  MP_CLIENT_SECRET: "client-secret",
  RESEND_API_KEY: "re_123",
  CORS_ORIGIN: "https://app.truckpool.app",
  TRUST_PROXY: "1",
};

/** NODE_ENV=production con todo lo que pide: cada test rompe una sola cosa */
function setProd() {
  process.env.NODE_ENV = "production";
  Object.assign(process.env, PROD_COMPLETO);
}

describe("assertServerEnv", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "un-secreto-cualquiera";
    process.env.DATABASE_URL = "postgresql://algo/algo";
    process.env.NODE_ENV = "development";
    // producción exige una APP_URL pública (ver los tests de APP_URL)
    process.env.APP_URL = "https://app.truckpool.app";
  });

  afterEach(() => {
    restoreAll();
  });

  describe("APP_URL", () => {
    it.each([
      ["sin definir", undefined],
      ["localhost", "http://localhost:5173"],
      ["127.0.0.1", "http://127.0.0.1:5173"],
      ["inválida", "no-es-una-url"],
    ])("aborta en producción con APP_URL %s: MP no vuelve al sitio", (_caso, valor) => {
      process.env.NODE_ENV = "production";
      if (valor === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = valor;
      expect(() => assertServerEnv()).toThrow(EnvError);
      expect(() => assertServerEnv()).toThrow(/APP_URL/);
    });

    it("arranca en producción con una APP_URL pública", () => {
      setProd();
      process.env.APP_URL = "https://app.truckpool.app";
      expect(() => assertServerEnv()).not.toThrow();
    });

    it("arranca en development con APP_URL en localhost", () => {
      process.env.APP_URL = "http://localhost:5173";
      expect(() => assertServerEnv()).not.toThrow();
    });
  });

  // L5 (02§2.6): en producción falta algo y el server no arranca, en vez de
  // fallar recién cuando alguien lo usa (o de quedar abierto, como CORS)
  describe("producción exige la configuración completa", () => {
    it("arranca con todo definido", () => {
      setProd();
      expect(() => assertServerEnv()).not.toThrow();
    });

    it.each(Object.keys(PROD_COMPLETO))("aborta si falta %s", (key) => {
      setProd();
      delete process.env[key];
      expect(() => assertServerEnv()).toThrow(EnvError);
      expect(() => assertServerEnv()).toThrow(new RegExp(key));
    });

    it.each(Object.keys(PROD_COMPLETO))("aborta si %s es solo espacios", (key) => {
      setProd();
      process.env[key] = "   ";
      expect(() => assertServerEnv()).toThrow(new RegExp(key));
    });

    it.each([
      ["APP_URL", "http://app.truckpool.app"],
      ["APP_URL", "https://localhost:5173"],
      ["API_PUBLIC_URL", "http://api.truckpool.app"],
      ["API_PUBLIC_URL", "https://127.0.0.1:4000"],
      ["API_PUBLIC_URL", "https://api.localhost"],
      ["API_PUBLIC_URL", "no-es-una-url"],
    ])("aborta con %s=%s: tiene que ser https y pública", (key, valor) => {
      setProd();
      process.env[key] = valor;
      expect(() => assertServerEnv()).toThrow(new RegExp(`${key}.*https`));
    });

    it.each([
      ["63 caracteres", "a".repeat(63)],
      ["65 caracteres", "a".repeat(65)],
      ["no hex", "z".repeat(64)],
    ])("aborta con TOKEN_ENCRYPTION_KEY de %s", (_caso, valor) => {
      setProd();
      process.env.TOKEN_ENCRYPTION_KEY = valor;
      expect(() => assertServerEnv()).toThrow(/TOKEN_ENCRYPTION_KEY.*64/);
    });

    it.each([["*"], ["https://app.truckpool.app,*"], [" , "]])(
      "aborta con CORS_ORIGIN=%j",
      (valor) => {
        setProd();
        process.env.CORS_ORIGIN = valor;
        expect(() => assertServerEnv()).toThrow(/CORS_ORIGIN/);
      }
    );

    it("acepta varios orígenes en CORS_ORIGIN", () => {
      setProd();
      process.env.CORS_ORIGIN = "https://app.truckpool.app, https://www.truckpool.app";
      expect(() => assertServerEnv()).not.toThrow();
    });

    it("con nada definido reporta cada faltante", () => {
      process.env.NODE_ENV = "production";
      for (const key of Object.keys(PROD_COMPLETO)) delete process.env[key];
      try {
        assertServerEnv();
        expect.unreachable("assertServerEnv tenía que abortar");
      } catch (err) {
        const problems = (err as EnvError).problems;
        for (const key of Object.keys(PROD_COMPLETO)) {
          expect(problems.join("\n")).toContain(key);
        }
        expect(problems).toHaveLength(Object.keys(PROD_COMPLETO).length);
      }
    });

    it("fuera de producción no exige nada de esto", () => {
      for (const key of Object.keys(PROD_COMPLETO)) delete process.env[key];
      expect(() => assertServerEnv()).not.toThrow();
    });
  });

  // L5: RATE_LIMITS apaga los límites solo fuera de producción (e2e, pruebas)
  describe("RATE_LIMITS", () => {
    it.each([["on"], ["off"], [""]])("acepta RATE_LIMITS=%j en development", (valor) => {
      process.env.RATE_LIMITS = valor;
      expect(() => assertServerEnv()).not.toThrow();
    });

    it("aborta en producción con RATE_LIMITS=off", () => {
      setProd();
      process.env.RATE_LIMITS = "off";
      expect(() => assertServerEnv()).toThrow(/RATE_LIMITS=off/);
    });

    it("arranca en producción con RATE_LIMITS=on", () => {
      setProd();
      process.env.RATE_LIMITS = "on";
      expect(() => assertServerEnv()).not.toThrow();
    });

    it.each([["false"], ["ON"], ["0"]])("aborta con RATE_LIMITS=%j", (valor) => {
      process.env.RATE_LIMITS = valor;
      expect(() => assertServerEnv()).toThrow(/RATE_LIMITS=.* no es válido/);
    });
  });

  describe("TRUST_PROXY", () => {
    it.each([["0"], ["1"], ["2"], ["true"], ["false"], [""]])(
      "acepta TRUST_PROXY=%j fuera de producción",
      (valor) => {
        process.env.TRUST_PROXY = valor;
        expect(() => assertServerEnv()).not.toThrow();
      }
    );

    it.each([["abc"], ["-1"], ["1.5"], ["TRUE"]])(
      "aborta con TRUST_PROXY=%j en cualquier entorno: hoy caía a false en silencio",
      (valor) => {
        process.env.TRUST_PROXY = valor;
        expect(() => assertServerEnv()).toThrow(/TRUST_PROXY=.* no es válido/);
      }
    );
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
        setProd();
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

  describe("MP_CHECKOUT_SANDBOX", () => {
    afterEach(() => {
      delete process.env.MP_CHECKOUT_SANDBOX;
    });

    it("aborta en producción con MP_CHECKOUT_SANDBOX=true: un pago real no va al sandbox", () => {
      process.env.NODE_ENV = "production";
      process.env.MP_CHECKOUT_SANDBOX = "true";
      expect(() => assertServerEnv()).toThrow(EnvError);
      expect(() => assertServerEnv()).toThrow(/MP_CHECKOUT_SANDBOX/);
    });

    it.each([["false"], [""], [undefined]])(
      "arranca en producción con MP_CHECKOUT_SANDBOX=%j",
      (valor) => {
        setProd();
        if (valor === undefined) delete process.env.MP_CHECKOUT_SANDBOX;
        else process.env.MP_CHECKOUT_SANDBOX = valor;
        expect(() => assertServerEnv()).not.toThrow();
      }
    );

    it("arranca en development con MP_CHECKOUT_SANDBOX=true", () => {
      process.env.MP_CHECKOUT_SANDBOX = "true";
      expect(() => assertServerEnv()).not.toThrow();
    });

    it("aborta con un valor desconocido", () => {
      process.env.MP_CHECKOUT_SANDBOX = "si";
      expect(() => assertServerEnv()).toThrow(/MP_CHECKOUT_SANDBOX="si" no es válido/);
    });
  });

  describe("JOBS_ENABLED", () => {
    afterEach(() => {
      delete process.env.JOBS_ENABLED;
    });

    it.each([
      ["sin definir", undefined, true],
      ["vacío", "", true],
      ["true", "true", true],
      ["false", "false", false],
    ])("arranca con JOBS_ENABLED %s", (_caso, valor, prendidos) => {
      if (valor === undefined) delete process.env.JOBS_ENABLED;
      else process.env.JOBS_ENABLED = valor;
      expect(() => assertServerEnv()).not.toThrow();
      expect(jobsStatus().enabled).toBe(prendidos);
    });

    it.each([["False"], ["0"], ['"false"'], ["false "]])(
      "aborta con JOBS_ENABLED=%j: un typo no deja los jobs prendidos en silencio",
      (valor) => {
        process.env.JOBS_ENABLED = valor;
        expect(() => assertServerEnv()).toThrow(EnvError);
        expect(() => assertServerEnv()).toThrow(/JOBS_ENABLED=.* no es válido/);
        expect(() => jobsStatus()).toThrow(EnvError);
      }
    );

    it("el log de arranque dice si los jobs quedaron prendidos o apagados", () => {
      process.env.JOBS_ENABLED = "false";
      expect(jobsStatus().message).toBe("jobs apagados (JOBS_ENABLED=false)");
      delete process.env.JOBS_ENABLED;
      expect(jobsStatus().message).toBe(
        "jobs prendidos (JOBS_ENABLED=true o sin definir)"
      );
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
    // producción además exige su configuración completa (ver más arriba)
    if (value === "production") setProd();
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
