import { describe, it, expect } from "vitest";
import {
  generateTrackingCode,
  normalizeTrackingCode,
  TRACKING_CODE_PATTERN,
} from "../lib/trackingCode.js";

describe("generateTrackingCode (U9)", () => {
  it("arma TP- y cuatro grupos de cuatro en base32 Crockford", () => {
    const code = generateTrackingCode();

    expect(code).toMatch(/^TP-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(code).toMatch(TRACKING_CODE_PATTERN);
  });

  it("no usa las letras ambiguas I, L, O ni U", () => {
    const chars = Array.from({ length: 500 }, generateTrackingCode)
      .join("")
      .replace(/^TP-|-/g, "");

    expect(chars).not.toMatch(/[ILOU]/);
  });

  it("no repite en 10.000 códigos", () => {
    const codes = new Set(Array.from({ length: 10_000 }, generateTrackingCode));

    expect(codes.size).toBe(10_000);
  });

  it("usa todo el alfabeto en cada posición (no hay posiciones fijas)", () => {
    // 80 bits repartidos en 16 posiciones de 5 bits: si alguna quedara fija
    // (por ejemplo, por sacar los bits de un uuid sin cuidado), se notaría acá.
    const codes = Array.from({ length: 4_000 }, () =>
      generateTrackingCode().slice(3).replace(/-/g, "")
    );
    for (let pos = 0; pos < 16; pos++) {
      const seen = new Set(codes.map((c) => c[pos]));
      expect(seen.size, `posición ${pos}`).toBe(32);
    }
  });
});

describe("normalizeTrackingCode", () => {
  it("pasa a mayúsculas y saca espacios", () => {
    expect(normalizeTrackingCode("  tp-7k3m-q9zx-a2b4-hn8d ")).toBe(
      "TP-7K3M-Q9ZX-A2B4-HN8D"
    );
  });

  it("en un código nuevo lee O como 0 e I/L como 1 (Crockford)", () => {
    expect(normalizeTrackingCode("TP-7K3M-Q9ZX-A2B4-HNOI")).toBe(
      "TP-7K3M-Q9ZX-A2B4-HN01"
    );
    expect(normalizeTrackingCode("tp-lk3m-q9zx-a2b4-hn8d")).toBe(
      "TP-1K3M-Q9ZX-A2B4-HN8D"
    );
  });

  it("a un código viejo no le cambia letras: la O del id del viaje es una O", () => {
    expect(normalizeTrackingCode("tp-ab1o-c1")).toBe("TP-AB1O-C1");
  });

  it("devuelve null si el texto es vacío o desmedido", () => {
    expect(normalizeTrackingCode("   ")).toBeNull();
    expect(normalizeTrackingCode("TP-" + "A".repeat(60))).toBeNull();
  });
});
