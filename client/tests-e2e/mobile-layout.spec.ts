import type { Locator, Page } from "@playwright/test";
import { test, expect, loginAs, apiGet, E2E } from "./fixtures.ts";

/**
 * Revisión de diseño: a 390 px de ancho (un teléfono) la página no se ensancha
 * y lo importante queda adentro de la pantalla. Sin datos de MP: solo se miran
 * pantallas y se abren diálogos, nada se confirma.
 */
const WIDTH = 390;
test.use({ viewport: { width: WIDTH, height: 844 }, isMobile: true, hasTouch: true });

/** ancho real del documento: más de 390 es scroll horizontal (como texto: los
 * e2e compilan sin los tipos del DOM) */
async function pageWidth(page: Page) {
  return page.evaluate<number>("document.documentElement.scrollWidth");
}

async function expectInsideViewport(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(WIDTH);
}

test.describe("RD1: header y diálogos del fletero", () => {
  for (const path of ["/viajes", "/perfil", `/viajes/${E2E.rolesTripId}`]) {
    test(`${path}: la página no se ensancha y el menú queda a mano`, async ({ page }) => {
      await loginAs(page, "carrier");
      await page.goto(path);
      const menu = page.getByRole("button", { name: "abrir menú" });
      await expect(menu).toBeVisible();
      expect(await pageWidth(page)).toBeLessThanOrEqual(WIDTH);
      await expectInsideViewport(menu);

      // «publicar viaje» sigue estando, dentro del menú móvil
      await menu.click();
      await expect(
        page.locator("#menu-movil").getByRole("link", { name: "publicar viaje" })
      ).toBeVisible();
    });
  }

  test("«¿salís ahora?» entra en la pantalla con sus dos botones", async ({ page }) => {
    await loginAs(page, "carrier");
    await page.goto(`/viajes/${E2E.rolesTripId}`);
    await page.getByRole("button", { name: "marcar en tránsito" }).click();

    const dialog = page.getByRole("dialog", { name: "¿salís ahora?" });
    await expect(dialog).toBeVisible();
    expect(await pageWidth(page)).toBeLessThanOrEqual(WIDTH);
    await expectInsideViewport(dialog);
    await expectInsideViewport(dialog.getByRole("button", { name: "volver" }));
    await expectInsideViewport(dialog.getByRole("button", { name: /^salir/ }));
    await dialog.getByRole("button", { name: "volver" }).click();
  });

  test("«aceptar solicitud» entra en la pantalla y scrollea hasta el título", async ({
    page,
  }) => {
    // una solicitud pendiente interceptada: el seed e2e no crea solicitudes
    const futuro = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    await page.route("**/api/users/trip-requests/received", (route) =>
      route.fulfill({
        json: [
          {
            id: "rd1-solicitud",
            origin: "Profesor Manuel García 6485, CABA",
            destination: "Tucumán 1545, CABA",
            desiredDate: futuro,
            estimatedVolume: 12,
            note: null,
            status: "PENDING",
            resultingTripId: null,
            createdAt: new Date().toISOString(),
            company: { id: "rd1-empresa", name: "Empresa de prueba" },
            carrier: { id: "rd1-fletero", name: "Transportes Flete" },
          },
        ],
      })
    );
    await loginAs(page, "carrier");
    await page.goto("/solicitudes");
    await page.getByRole("button", { name: "aceptar", exact: true }).click();

    const title = page.getByRole("heading", { name: /^aceptar:/ });
    await expect(title).toBeVisible();
    expect(await pageWidth(page)).toBeLessThanOrEqual(WIDTH);
    await title.scrollIntoViewIfNeeded();
    const box = await title.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    await expectInsideViewport(
      page.getByRole("button", { name: "confirmar y publicar" })
    );
  });
});

test.describe("RD3 / QW13: la fila de la carga en mobile", () => {
  test("los textos de la seña se leen a lo ancho y los botones quedan en la tarjeta", async ({
    page,
  }) => {
    await loginAs(page, "company");
    await page.goto(`/viajes/${E2E.rolesTripId}`);
    const row = page
      .getByRole("list", { name: "cargas del viaje" })
      .getByRole("listitem")
      .filter({ hasText: "E2E carga de la dueña" });
    await expect(row.getByRole("button", { name: "retirar carga" })).toBeVisible();
    expect(await pageWidth(page)).toBeLessThanOrEqual(WIDTH);

    const card = (await row.boundingBox())!;
    // antes: una columna de 1-2 palabras al lado de los botones
    const deposit = (await row.getByText(/^seña de \$/).boundingBox())!;
    expect(deposit.width).toBeGreaterThan(card.width * 0.6);

    for (const name of ["retirar carga", /^pagar seña/i]) {
      const box = (await row.getByRole("button", { name }).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("RD9: /rastrear con un resultado", () => {
  test("la página no se ensancha y «limpiar» queda a mano", async ({ page }) => {
    const trip = await apiGet<{
      cargoItems: { description: string; trackingCode: string }[];
    }>(`/trips/${E2E.rolesTripId}`, "carrier");
    const own = trip.cargoItems.find(
      (c) => c.description === E2E.cargo.owner.description
    )!;

    await page.goto("/rastrear");
    await page.getByLabel("código de seguimiento").fill(own.trackingCode);
    await page.getByRole("button", { name: "rastrear" }).click();
    await expect(page.getByRole("heading", { name: own.description })).toBeVisible();

    expect(await pageWidth(page)).toBeLessThanOrEqual(WIDTH);
    await expectInsideViewport(page.getByRole("button", { name: "limpiar" }));
    // «← volver al inicio» en una sola línea (antes se partía en 3)
    const back = (await page
      .getByRole("link", { name: "← volver al inicio" })
      .boundingBox())!;
    expect(back.height).toBeLessThan(30);
  });
});
