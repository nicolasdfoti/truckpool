import { describe, it, expect, afterEach } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "../lib/crypto.js";

const KEY = process.env.TOKEN_ENCRYPTION_KEY;

function withKey(value: string | undefined, run: () => void) {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  if (value === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previous;
  }
}

describe("cifrado de secretos", () => {
  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
  });

  it("descifra lo que cifró", () => {
    const token = "APP_USR-abc123-access-token";
    const stored = encryptSecret(token);

    expect(stored).not.toContain(token);
    expect(decryptSecret(stored)).toBe(token);
  });

  it("no guarda el token en claro", () => {
    const stored = encryptSecret("APP_USR-abc123-access-token");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored.includes("APP_USR")).toBe(false);
    expect(isEncryptedSecret(stored)).toBe(true);
  });

  it("cifra dos veces el mismo token con resultados distintos", () => {
    // IV aleatorio: si dos usuarios tuvieran el mismo token, en la base no
    // pueden verse idénticos los sobres
    expect(encryptSecret("mismo")).not.toBe(encryptSecret("mismo"));
  });

  it("falla explícito si la clave no está", () => {
    withKey(undefined, () => {
      expect(() => encryptSecret("token")).toThrowError(
        expect.objectContaining({ code: "TOKEN_ENCRYPTION_KEY_MISSING" })
      );
    });
  });

  it("falla explícito si la clave no tiene 32 bytes", () => {
    withKey("corto", () => {
      expect(() => encryptSecret("token")).toThrowError(
        expect.objectContaining({ code: "TOKEN_ENCRYPTION_KEY_INVALID" })
      );
    });
  });

  it("falla explícito si el token quedó en claro (valor viejo)", () => {
    // un token guardado antes del cifrado tiene que hacer ruido, no devolver
    // basura contra la API de Mercado Pago
    expect(() => decryptSecret("APP_USR-token-en-claro")).toThrowError(
      expect.objectContaining({ code: "MP_TOKEN_NOT_ENCRYPTED" })
    );
  });

  it("falla si la clave cambió", () => {
    const stored = encryptSecret("APP_USR-abc123");
    withKey("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", () => {
      expect(() => decryptSecret(stored)).toThrowError(
        expect.objectContaining({ code: "MP_TOKEN_DECRYPT_FAILED" })
      );
    });
  });

  it("falla si el sobre fue alterado", () => {
    const stored = encryptSecret("APP_USR-abc123");
    const parts = stored.split(":");
    const tampered = [parts[0], parts[1], parts[2], "b3RoZXJz"].join(":");

    expect(() => decryptSecret(tampered)).toThrowError(
      expect.objectContaining({ code: "MP_TOKEN_DECRYPT_FAILED" })
    );
  });
});
