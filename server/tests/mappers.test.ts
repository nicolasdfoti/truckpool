import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { toCargoItemResponse } from "../lib/mappers.js";

// D7 (c): la comisión es solo sobre lo efectivamente cobrado. MP devuelve la
// comisión en proporción a lo reembolsado (verificado con pago real, ver D7 en
// docs/review/04-launch.md). Lo neto se deriva en el mapper desde
// `refundedAmount`; `platformFeeAmount` y `carrierAmount` siguen siendo lo
// pactado en la preference y no se tocan.

function seña(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay1",
    cargoItemId: "i1",
    type: "DEPOSIT",
    status: "APPROVED",
    amount: new Prisma.Decimal("42.00"),
    refundedAmount: null,
    mpPreferenceId: "pref-1",
    mpPaymentId: "mp-1",
    platformFeeAmount: new Prisma.Decimal("4.20"),
    carrierAmount: new Prisma.Decimal("37.80"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function carga(payment: Record<string, unknown>) {
  return {
    id: "i1",
    tripId: "t1",
    companyId: "c1",
    description: "Maquinaria",
    volume: 5,
    priceShare: new Prisma.Decimal("210.00"),
    depositAmount: new Prisma.Decimal("42.00"),
    status: "CONFIRMED",
    createdAt: new Date(),
    cancelledAt: null,
    cancellationFeeAmount: null,
    pickupAddress: "Córdoba",
    pickupLat: null,
    pickupLng: null,
    trackingCode: "TP-T1-C1",
    stopOrder: null,
    payments: [payment],
  } as unknown as Parameters<typeof toCargoItemResponse>[0];
}

const repartoDe = (payment: Record<string, unknown>) => {
  const p = toCargoItemResponse(carga(payment)).depositPayment!;
  return {
    platformFeeAmount: p.platformFeeAmount,
    carrierAmount: p.carrierAmount,
    netPlatformFeeAmount: p.netPlatformFeeAmount,
    netCarrierAmount: p.netCarrierAmount,
  };
};

describe("toPaymentResponse: comisión neta derivada de lo devuelto (D7 c)", () => {
  it("sin devoluciones, lo neto es lo pactado", () => {
    expect(repartoDe(seña())).toEqual({
      platformFeeAmount: 4.2,
      carrierAmount: 37.8,
      netPlatformFeeAmount: 4.2,
      netCarrierAmount: 37.8,
    });
  });

  it("devolución del 50 % (fase 2 del pago real: $21 de $42): la plataforma se queda $2,10", () => {
    expect(repartoDe(seña({ refundedAmount: new Prisma.Decimal("21.00") }))).toEqual({
      // lo pactado no se toca
      platformFeeAmount: 4.2,
      carrierAmount: 37.8,
      netPlatformFeeAmount: 2.1,
      netCarrierAmount: 18.9,
    });
  });

  it("devolución total (fase 1 del pago real: $105): la plataforma queda en $0", () => {
    expect(
      repartoDe(
        seña({
          status: "REFUNDED",
          amount: new Prisma.Decimal("105.00"),
          refundedAmount: new Prisma.Decimal("105.00"),
          platformFeeAmount: new Prisma.Decimal("10.50"),
          carrierAmount: new Prisma.Decimal("94.50"),
        })
      )
    ).toEqual({
      platformFeeAmount: 10.5,
      carrierAmount: 94.5,
      netPlatformFeeAmount: 0,
      netCarrierAmount: 0,
    });
  });

  it("REFUNDED sin refundedAmount asentado cuenta como devuelto entero", () => {
    // el webhook pasa el pago a REFUNDED con el CAS; refundedAmount puede
    // llegar después (o no, si lo devuelto fue el saldo)
    expect(repartoDe(seña({ status: "REFUNDED", refundedAmount: null }))).toMatchObject({
      netPlatformFeeAmount: 0,
      netCarrierAmount: 0,
    });
  });

  it("redondea a centavos y lo neto suma lo que quedó cobrado", () => {
    const reparto = repartoDe(
      seña({
        amount: new Prisma.Decimal("100.00"),
        refundedAmount: new Prisma.Decimal("33.33"),
        platformFeeAmount: new Prisma.Decimal("10.00"),
        carrierAmount: new Prisma.Decimal("90.00"),
      })
    );
    // quedaron 66,67 cobrados: 10 % de comisión (6,667 → 6,67) y el resto
    expect(reparto.netPlatformFeeAmount).toBe(6.67);
    expect(reparto.netCarrierAmount).toBe(60);
  });

  it("con contracargo no se deriva: no sabemos qué hizo MP con la comisión", () => {
    expect(repartoDe(seña({ status: "CHARGED_BACK", mpPaymentId: "mp-1" }))).toEqual({
      platformFeeAmount: 4.2,
      carrierAmount: 37.8,
      netPlatformFeeAmount: null,
      netCarrierAmount: null,
    });
  });

  it("sin reparto asentado, lo neto también es null", () => {
    expect(
      repartoDe(seña({ platformFeeAmount: null, carrierAmount: null }))
    ).toMatchObject({ netPlatformFeeAmount: null, netCarrierAmount: null });
  });
});
