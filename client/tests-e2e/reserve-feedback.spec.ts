import { test, expect, loginAs, E2E } from "./fixtures.ts";

/**
 * RD7: después de «sumar carga» la página avisa que se reservó y lleva a la
 * fila, donde están «pagar seña» y el vencimiento. Reservar de verdad exige que
 * el fletero tenga MP conectado, así que el POST se intercepta y la carga nueva
 * se suma a la respuesta del viaje (una copia de la carga de la dueña).
 */
const TRIP = E2E.rolesTripId;
const NEW_ID = "rd7-carga-nueva";
const NEW_DESCRIPTION = "RD7 heladera nueva";

test("al reservar: aviso en la fila nueva y la fila a la vista", async ({ page }) => {
  let created = false;
  await page.route(`**/api/trips/${TRIP}/cargo-items`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    created = true;
    await route.fulfill({ status: 201, json: { id: NEW_ID } });
  });
  await page.route(`**/api/trips/${TRIP}`, async (route) => {
    const response = await route.fetch();
    const trip = (await response.json()) as {
      cargoItems: Record<string, unknown>[];
    };
    if (created) {
      const own = trip.cargoItems.find((c) => c.description === "E2E carga de la dueña");
      trip.cargoItems.push({
        ...own,
        id: NEW_ID,
        description: NEW_DESCRIPTION,
        trackingCode: "TP-RD7R-D7RD-7RD7-RD7R",
      });
    }
    await route.fulfill({ response, json: trip });
  });

  await loginAs(page, "company");
  await page.goto(`/viajes/${TRIP}`);
  await page.getByLabel("qué mandás").fill(NEW_DESCRIPTION);
  await page.getByLabel("volumen (m³)").fill("1");
  await page.locator("#pickupAddress").fill("Bv. Oroño 1200, Rosario");
  await page.getByRole("button", { name: "sumar carga" }).click();

  const row = page
    .getByRole("list", { name: "cargas del viaje" })
    .getByRole("listitem")
    .filter({ hasText: NEW_DESCRIPTION });
  await expect(row.getByRole("status")).toHaveText(
    "listo, reservaste tu lugar. pagá la seña para confirmarlo."
  );
  await expect(row.getByRole("button", { name: /^pagar seña/i })).toBeInViewport();
  // el formulario quedó vacío para otra carga
  await expect(page.getByLabel("qué mandás")).toHaveValue("");
});
