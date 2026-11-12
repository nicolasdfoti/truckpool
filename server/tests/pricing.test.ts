import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  calculateSuggestedPrice,
  cargoPrice,
  SUGGESTION_MAX_DISTANCE_KM,
  priceRangeFor,
  rateFor,
  RATE_TABLE,
  PRICE_TOLERANCE,
  ROAD_DISTANCE_FACTOR,
} from "../lib/pricing.js";

describe("calculateSuggestedPrice", () => {
  it("suma la tarifa base más el costo por km de ruta", () => {
    // el precio corre sobre la distancia de ruta estimada (×1.25), no la recta
    const km = 500 * ROAD_DISTANCE_FACTOR;
    expect(calculateSuggestedPrice("Camión", 500)).toBe(5_000 + 260 * km);
    expect(calculateSuggestedPrice("Chasis", 500)).toBe(3_000 + 180 * km);
    expect(calculateSuggestedPrice("Tráiler", 500)).toBe(9_000 + 380 * km);
  });

  it("cobra por la distancia de ruta, no por la línea recta", () => {
    // sin el factor, un viaje de 374 km se pagaría como si fuera de 374 km de
    // ruta cuando en realidad son ~700
    const recto = 9000 + 380 * 374;
    expect(calculateSuggestedPrice("Tráiler", 374)).toBeGreaterThan(recto);
    expect(ROAD_DISTANCE_FACTOR).toBeGreaterThan(1);
  });

  it("trata Semi y Tráiler como el mismo vehículo", () => {
    expect(rateFor("Semi")).toBe(rateFor("Tráiler"));
    expect(calculateSuggestedPrice("Semi", 320)).toBe(
      calculateSuggestedPrice("Tráiler", 320)
    );
  });

  it("redondea a centenas", () => {
    expect(calculateSuggestedPrice("Camión", 320) % 100).toBe(0);
    expect(calculateSuggestedPrice("Camión", 321) % 100).toBe(0);
    // 88.200 era el número con línea recta: con el factor de ruta no da lo mismo
    expect(calculateSuggestedPrice("Camión", 320)).not.toBe(88_200);
    // ningún resultado termina en una moneda que no sea múltiplo de 100
    for (const truckType of Object.keys(RATE_TABLE)) {
      for (const km of [1, 7.3, 99.99, 137, 640.4, 1234]) {
        expect(calculateSuggestedPrice(truckType, km) % 100).toBe(0);
      }
    }
  });

  it("es proporcional a la distancia", () => {
    const corto = calculateSuggestedPrice("Camión", 100);
    const largo = calculateSuggestedPrice("Camión", 1000);
    // 10 veces la distancia no da 10 veces el precio: la base es fija
    expect(largo).toBeGreaterThan(corto * 5);
    expect(largo).toBeLessThan(corto * 10);
  });

  it("un vehículo más grande cuesta más para la misma distancia", () => {
    const km = 400;
    expect(calculateSuggestedPrice("Chasis", km)).toBeLessThan(
      calculateSuggestedPrice("Camión", km)
    );
    expect(calculateSuggestedPrice("Camión", km)).toBeLessThan(
      calculateSuggestedPrice("Tráiler", km)
    );
  });

  it("no se rompe con tipos raros ni distancias imposibles", () => {
    // el campo truckType es texto libre: un tipo desconocido no puede tirar
    // el cálculo
    expect(rateFor("Furión")).toEqual(rateFor("Camión"));
    expect(calculateSuggestedPrice("Furión", 400)).toBeGreaterThan(0);
    // 0 km es un viaje sin recorrido, pero no puede dar un precio negativo
    expect(calculateSuggestedPrice("Camión", 0)).toBe(5_000);
    expect(calculateSuggestedPrice("Camión", -50)).toBe(5_000);
  });

  it("ignora mayúsculas y acentos", () => {
    const referencia = calculateSuggestedPrice("Camión", 500);
    expect(calculateSuggestedPrice("CAMION", 500)).toBe(referencia);
    expect(calculateSuggestedPrice("  camión  ", 500)).toBe(referencia);
  });
});

describe("priceRangeFor", () => {
  it("el rango es el sugerido ±15%", () => {
    const range = priceRangeFor("Camión", 500)!;
    const sugerido = calculateSuggestedPrice("Camión", 500);
    expect(range.suggestedPrice).toBe(sugerido);
    expect(PRICE_TOLERANCE).toBe(0.15);
    // el piso se redondea para abajo y el techo para arriba, así el rango
    // mostrado nunca es más angosto que el ±15% real
    expect(range.minPrice).toBeLessThanOrEqual(sugerido * 0.85);
    expect(range.maxPrice).toBeGreaterThanOrEqual(sugerido * 1.15);
    expect(range.minPrice).toBeLessThan(range.maxPrice);
  });

  it("el rango nunca es más angosto que el ±15% real", () => {
    // un precio apenas por debajo del -15% exacto tiene que entrar: el fletero
    // no puede quedar afuera del rango que le mostramos
    const range = priceRangeFor("Tráiler", 137)!;
    const exacto = range.suggestedPrice * (1 - PRICE_TOLERANCE);
    expect(range.minPrice).toBeLessThanOrEqual(exacto);
    const techo = range.suggestedPrice * (1 + PRICE_TOLERANCE);
    expect(range.maxPrice).toBeGreaterThanOrEqual(techo);
  });

  // D5: con más de 5.000 km (más que cualquier viaje dentro de Argentina) el
  // geocode casi seguro resolvió mal una punta: no se sugiere nada
  it("sin sugerencia con más de 5.000 km", () => {
    expect(SUGGESTION_MAX_DISTANCE_KM).toBe(5_000);
    expect(priceRangeFor("Camión", 5_000.1)).toBeNull();
    expect(priceRangeFor("Camión", 10_412)).toBeNull();
  });

  it("hasta 5.000 km justos sí sugiere", () => {
    expect(priceRangeFor("Camión", 5_000)).toMatchObject({
      distanceKm: 5_000,
      suggestedPrice: calculateSuggestedPrice("Camión", 5_000),
    });
  });
});

describe("cargoPrice", () => {
  it("prorratea el precio del viaje por volumen y saca la seña de esa parte", () => {
    // 1500 por 30 m³, 10 m³ → 500; 20 % de seña → 100; saldo 400
    const quote = cargoPrice(
      { price: new Prisma.Decimal("1500.00"), capacityTotal: 30, depositPercent: 20 },
      10
    );
    expect(quote.priceShare.toFixed(2)).toBe("500.00");
    expect(quote.depositAmount.toFixed(2)).toBe("100.00");
    expect(quote.balanceAmount.toFixed(2)).toBe("400.00");
  });

  it("redondea a centavos y el saldo es lo que falta para el precio de la carga", () => {
    // 1000 / 3 = 333.333… → 333.33; 15 % = 49.9995 → 50.00; saldo 283.33
    const quote = cargoPrice(
      { price: new Prisma.Decimal("1000.00"), capacityTotal: 3, depositPercent: 15 },
      1
    );
    expect(quote.priceShare.toFixed(2)).toBe("333.33");
    expect(quote.depositAmount.toFixed(2)).toBe("50.00");
    expect(quote.balanceAmount.toFixed(2)).toBe("283.33");
    expect(quote.depositAmount.plus(quote.balanceAmount).equals(quote.priceShare)).toBe(
      true
    );
  });

  it("devuelve Decimal, nunca number: la plata no pasa por coma flotante", () => {
    const quote = cargoPrice({ price: "0.30", capacityTotal: 3, depositPercent: 10 }, 1);
    expect(quote.priceShare).toBeInstanceOf(Prisma.Decimal);
    expect(quote.priceShare.toFixed(2)).toBe("0.10");
    expect(quote.depositAmount.toFixed(2)).toBe("0.01");
  });
});
