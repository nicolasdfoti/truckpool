import type { Page } from "@playwright/test";
import { test, expect, loginAs, apiGet, API_URL, E2E, type E2EUser } from "./fixtures.ts";

/**
 * L3: el detalle del viaje según quién lo mira (viewerAccess de L2). Usa los
 * viajes de server/prisma/seed-e2e.ts: en el de roles, empresa@ es la dueña,
 * e2e-segunda@ tiene otra carga viva, e2e-ex@ retiró la suya y e2e-otra@ no
 * tiene carga.
 */

type CargoRow = {
  description: string;
  pickupAddress: string;
  trackingCode: string;
  priceShare: number;
};

const ROLES_TRIP = `/viajes/${E2E.rolesTripId}`;
const TRANSIT_TRIP = `/viajes/${E2E.transitTripId}`;
const REVIEWS_TRIP = `/viajes/${E2E.reviewsTripId}`;

// 4 + 3 m³ vivos de 30: la carga retirada no cuenta
const OCCUPANCY_LINE = "ya hay 2 cargas en este viaje (7 m³). quedan 23 m³ libres.";
const ROUTE_TEXT_FOR_THIRD_PARTIES =
  "sale de Córdoba y llega a Rosario. el mapa con las paradas lo ven el fletero y las empresas con carga en el viaje.";

/** las cargas del viaje de roles con todos sus datos, leídas como el fletero */
let cargo: { owner: CargoRow; second: CargoRow; former: CargoRow };

test.beforeAll(async () => {
  const trip = await apiGet<{ cargoItems: CargoRow[] }>(
    `/trips/${E2E.rolesTripId}`,
    "carrier"
  );
  const byDescription = (description: string) => {
    const row = trip.cargoItems.find((item) => item.description === description);
    if (!row) throw new Error(`falta la carga "${description}": ¿corrió el seed e2e?`);
    return row;
  };
  cargo = {
    owner: byDescription(E2E.cargo.owner.description),
    second: byDescription(E2E.cargo.second.description),
    former: byDescription(E2E.cargo.former.description),
  };
});

/** "300,00": el monto como lo muestra la UI, sin el símbolo */
function amountText(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2 });
}

/** descripción, dirección, código y monto de una carga: nada tiene que verse */
async function expectHidden(page: Page, row: CargoRow) {
  const body = page.locator("body");
  await expect(body).not.toContainText(row.description);
  await expect(body).not.toContainText(row.pickupAddress);
  await expect(body).not.toContainText(row.trackingCode);
  await expect(body).not.toContainText(amountText(row.priceShare));
}

/** registra cada respuesta 401/403 de la API mientras se usa la página */
function trackDenied(page: Page) {
  const denied: string[] = [];
  page.on("response", (res) => {
    if (res.url().startsWith(API_URL) && [401, 403].includes(res.status())) {
      denied.push(`${res.status()} ${res.url()}`);
    }
  });
  return denied;
}

async function openTrip(page: Page, path: string, user: E2EUser | null) {
  if (user) await loginAs(page, user);
  const denied = trackDenied(page);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // que lleguen las queries de la página (y sus reintentos) antes de mirar
  await page.waitForLoadState("networkidle");
  return denied;
}

test.describe("ocupación y cargas por rol", () => {
  for (const [label, user] of [
    ["anónimo", null],
    ["otra empresa", "otherCompany"],
  ] as const) {
    test(`${label}: solo la ocupación, sin datos de las cargas`, async ({ page }) => {
      await openTrip(page, ROLES_TRIP, user);
      await expect(page.getByText(OCCUPANCY_LINE)).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "cargas del viaje" })
      ).not.toBeVisible();
      await expect(page.locator("body")).not.toContainText(E2E.departureAddress);
      await expectHidden(page, cargo.owner);
      await expectHidden(page, cargo.second);
      await expectHidden(page, cargo.former);
    });
  }

  test("empresa dueña: su carga completa y la ajena como otra carga", async ({
    page,
  }) => {
    await openTrip(page, ROLES_TRIP, "company");
    await expect(page.getByText(OCCUPANCY_LINE)).toBeVisible();
    const list = page.getByRole("list", { name: "cargas del viaje" });
    await expect(list.getByText(cargo.owner.description)).toBeVisible();
    await expect(list.getByText(`retiro: ${cargo.owner.pickupAddress}`)).toBeVisible();
    await expect(list.getByText(`código: ${cargo.owner.trackingCode}`)).toBeVisible();
    await expect(list.getByText("otra carga · 3 m³")).toBeVisible();
    // la retirada del ex participante no aparece ni como "otra carga"
    await expect(list.getByText(/otra carga/)).toHaveCount(1);
    await expectHidden(page, cargo.second);
    await expectHidden(page, cargo.former);
  });

  test("ex participante: su carga retirada y nada de las demás", async ({ page }) => {
    await openTrip(page, ROLES_TRIP, "formerCompany");
    await expect(page.getByText(OCCUPANCY_LINE)).toBeVisible();
    const list = page.getByRole("list", { name: "cargas del viaje" });
    await expect(list.getByText(cargo.former.description)).toBeVisible();
    await expect(list.getByText("retirada sin seña cobrada")).toBeVisible();
    await expect(list.getByText(/otra carga/)).toHaveCount(0);
    await expectHidden(page, cargo.owner);
    await expectHidden(page, cargo.second);
  });

  test("fletero: todas las cargas", async ({ page }) => {
    await openTrip(page, ROLES_TRIP, "carrier");
    await expect(page.getByText(OCCUPANCY_LINE)).toBeVisible();
    const list = page.getByRole("list", { name: "cargas del viaje" });
    for (const row of [cargo.owner, cargo.second, cargo.former]) {
      await expect(list.getByText(row.description)).toBeVisible();
    }
    await expect(list.getByText(/otra carga/)).toHaveCount(0);
  });
});

test.describe("paradas por rol", () => {
  for (const [label, user] of [
    ["anónimo", null],
    ["otra empresa", "otherCompany"],
    ["ex participante", "formerCompany"],
  ] as const) {
    test(`${label}: no ve paradas ni las pide`, async ({ page }) => {
      const denied = await openTrip(page, ROLES_TRIP, user);
      await expect(
        page.getByRole("heading", { name: "paradas de retiro" })
      ).not.toBeVisible();
      expect(denied.filter((entry) => entry.includes("/stops"))).toEqual([]);
    });
  }

  test("empresa dueña: su parada completa y la ajena como otra parada", async ({
    page,
  }) => {
    await openTrip(page, ROLES_TRIP, "company");
    const stops = page.getByRole("region", { name: "paradas del viaje" });
    await expect(stops.getByText(cargo.owner.pickupAddress)).toBeVisible();
    await expect(stops.getByText("otra parada · 3 m³")).toBeVisible();
    // la empresa no reordena: sin manijas de arrastre
    await expect(stops.getByRole("button", { name: /^mover/ })).toHaveCount(0);
    await expectHidden(page, cargo.second);
  });

  test("fletero: todas las paradas, reordenables", async ({ page }) => {
    await openTrip(page, ROLES_TRIP, "carrier");
    const stops = page.getByRole("region", { name: "paradas del viaje" });
    await expect(stops.getByText(cargo.owner.pickupAddress)).toBeVisible();
    await expect(stops.getByText(cargo.second.pickupAddress)).toBeVisible();
    await expect(stops.getByRole("button", { name: /^mover/ })).toHaveCount(2);
  });
});

test.describe("recorrido por rol", () => {
  for (const [label, user] of [
    ["anónimo", null],
    ["otra empresa", "otherCompany"],
  ] as const) {
    test(`${label}: origen y destino, sin mapa ni 401/403`, async ({ page }) => {
      const denied = await openTrip(page, ROLES_TRIP, user);
      await expect(page.getByText(ROUTE_TEXT_FOR_THIRD_PARTIES)).toBeVisible();
      await expect(page.locator(".leaflet-container")).toHaveCount(0);
      expect(denied).toEqual([]);
    });
  }

  for (const [label, user] of [
    ["empresa dueña", "company"],
    ["fletero", "carrier"],
  ] as const) {
    test(`${label}: mapa del recorrido y punto de salida`, async ({ page }) => {
      const denied = await openTrip(page, ROLES_TRIP, user);
      await expect(page.locator(".leaflet-container")).toHaveCount(1);
      await expect(page.getByText(`sale desde ${E2E.departureAddress}`)).toBeVisible();
      expect(denied).toEqual([]);
    });
  }
});

test.describe("ex participante (D9)", () => {
  test("viaje abierto: conserva el chat, sin paradas ni mapa", async ({ page }) => {
    const denied = await openTrip(page, ROLES_TRIP, "formerCompany");
    await expect(page.getByRole("heading", { name: "mensajes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "paradas de retiro" })).toHaveCount(0);
    await expect(page.locator(".leaflet-container")).toHaveCount(0);
    await expect(page.getByText(ROUTE_TEXT_FOR_THIRD_PARTIES)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(E2E.departureAddress);
    expect(denied).toEqual([]);
  });

  test("viaje en tránsito: escribe en el chat, sin ubicación ni remito", async ({
    page,
  }) => {
    const denied = await openTrip(page, TRANSIT_TRIP, "formerCompany");
    await expect(
      page.getByText(E2E.transitCargo.former.description, { exact: true })
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      E2E.transitCargo.owner.description
    );
    await expect(page.getByRole("heading", { name: "ubicación del viaje" })).toHaveCount(
      0
    );
    await expect(page.getByRole("button", { name: "descargar remito" })).toHaveCount(0);
    await expect(page.locator(".leaflet-container")).toHaveCount(0);

    // D9: lee y escribe su conversación con el fletero
    const body = `E2E consulta por el reembolso ${Date.now()}`;
    await page.getByLabel("mensaje", { exact: true }).fill(body);
    await page.getByRole("button", { name: "enviar", exact: true }).click();
    await expect(page.getByText(body)).toBeVisible();

    // un ciclo del polling del chat (5 s), para ver que ninguna query da 401/403
    await page.waitForTimeout(6000);
    expect(denied).toEqual([]);
  });

  test("la dueña, en el mismo viaje, ve la ubicación y el remito", async ({ page }) => {
    const denied = await openTrip(page, TRANSIT_TRIP, "company");
    await expect(
      page.getByRole("heading", { name: "ubicación del viaje" })
    ).toBeVisible();
    await expect(page.getByText(/última posición/)).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "descargar remito" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    expect(denied).toEqual([]);
  });
});

test.describe("reseñas sin la empresa que calificó", () => {
  test("anónimo: etiqueta fija en el detalle", async ({ page }) => {
    await openTrip(page, REVIEWS_TRIP, null);
    const review = page.getByRole("listitem").filter({ hasText: E2E.reviewComment });
    await expect(review.getByText("empresa que mandó carga en este viaje")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Comercial Norte");
  });

  test("anónimo: etiqueta fija en el perfil del fletero", async ({ page }) => {
    const trip = await apiGet<{ carrierId: string }>(
      `/trips/${E2E.reviewsTripId}`,
      "carrier"
    );
    await page.goto(`/fleteros/${trip.carrierId}`);
    const review = page.getByRole("listitem").filter({ hasText: E2E.reviewComment });
    await expect(review.getByText("empresa que viajó con este fletero")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Comercial Norte");
  });

  test("la empresa que calificó ve que ya calificó", async ({ page }) => {
    await openTrip(page, REVIEWS_TRIP, "company");
    await expect(page.getByText("ya calificaste a")).toBeVisible();
    await expect(page.getByRole("button", { name: "enviar calificación" })).toHaveCount(
      0
    );
  });
});
