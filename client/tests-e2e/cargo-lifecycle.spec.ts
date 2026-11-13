import type { Page } from "@playwright/test";
import { test, expect, loginAs, E2E } from "./fixtures.ts";

/**
 * L7: el ciclo de la carga en el detalle del viaje, contra la API de verdad y
 * los viajes de server/prisma/seed-e2e.ts. Nada de lo que corre acá hace que el
 * server llame a Mercado Pago: solo se retira de verdad la carga sin seña, y lo
 * que es de MP (la preference) se intercepta en el navegador.
 *
 * Los tests van en orden y comparten el viaje: el seed lo deja como nuevo en
 * cada corrida (global-setup).
 */
test.describe.configure({ mode: "serial" });

const LIFECYCLE_TRIP = `/viajes/${E2E.lifecycleTripId}`;
const { unpaid, paidPending, confirmed } = E2E.lifecycleCargo;

/** la fila de una carga en «cargas del viaje», por su descripción */
function cargoRow(page: Page, description: string) {
  return page
    .getByRole("list", { name: "cargas del viaje" })
    .getByRole("listitem")
    .filter({ hasText: description });
}

/** "100,00": el monto como lo muestra la UI, sin el símbolo */
function amountText(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2 });
}

test.describe("retiro con diálogo propio (U21)", () => {
  test("carga confirmada con seña pagada: desglose, Escape cierra y el foco vuelve", async ({
    page,
  }) => {
    await loginAs(page, "company");
    await page.goto(LIFECYCLE_TRIP);

    const row = cargoRow(page, confirmed.description);
    const withdraw = row.getByRole("button", { name: "retirar carga" });
    await withdraw.click();

    const dialog = page.getByRole("dialog", { name: "¿retirar esta carga?" });
    await expect(dialog).toBeVisible();
    // foco inicial en el botón que no hace nada
    await expect(dialog.getByRole("button", { name: "mantener" })).toBeFocused();
    await expect(dialog).toContainText("el fletero ya la había confirmado");
    await expect(dialog).toContainText(
      `seña pagada$ ${amountText(confirmed.depositAmount)}`
    );
    // a 10 días de la salida: vuelve toda la seña, nada retenido
    await expect(dialog).toContainText(
      `te devolvemos$ ${amountText(confirmed.depositAmount)}`
    );
    await expect(dialog).not.toContainText("se retiene$");
    await expect(dialog).toContainText(
      "faltan más de 48 h para la salida: te devolvemos toda la seña."
    );
    await expect(dialog).toContainText("el reembolso lo procesa Mercado Pago");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(withdraw).toBeFocused();
    // no se retiró nada
    await expect(row).not.toContainText("retirada");
  });

  test("el Tab queda atrapado dentro del diálogo", async ({ page }) => {
    await loginAs(page, "company");
    await page.goto(LIFECYCLE_TRIP);
    await cargoRow(page, confirmed.description)
      .getByRole("button", { name: "retirar carga" })
      .click();

    const dialog = page.getByRole("dialog", { name: "¿retirar esta carga?" });
    const keep = dialog.getByRole("button", { name: "mantener" });
    const confirm = dialog.getByRole("button", { name: "retirar carga" });
    await expect(confirm).toBeEnabled();
    await expect(keep).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(keep).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirm).toBeFocused();

    await keep.click();
    await expect(dialog).toBeHidden();
  });

  test("carga sin seña: no hay nada que devolver y se retira de verdad", async ({
    page,
  }) => {
    await loginAs(page, "company");
    await page.goto(LIFECYCLE_TRIP);

    const row = cargoRow(page, unpaid.description);
    // «retirar carga» se lee como botón (outline danger), no como label
    await row.getByRole("button", { name: "retirar carga" }).click();

    const dialog = page.getByRole("dialog", { name: "¿retirar esta carga?" });
    await expect(dialog).toContainText(
      "todavía no pagaste la seña, así que no hay nada que devolver."
    );
    await expect(dialog).not.toContainText("te devolvemos");

    await dialog.getByRole("button", { name: "retirar carga" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("retirada");
    await expect(row).toContainText("retirada sin seña cobrada");
  });
});

test.describe("confirmar carga solo el fletero (D1)", () => {
  test("la empresa no ve «confirmar carga» ni con la seña pagada", async ({ page }) => {
    await loginAs(page, "secondCompany");
    await page.goto(LIFECYCLE_TRIP);

    const row = cargoRow(page, paidPending.description);
    await expect(row).toContainText("seña pagada");
    await expect(page.getByRole("button", { name: "confirmar carga" })).toHaveCount(0);
  });

  test("el fletero ve hasta cuándo espera la seña de una carga sin pagar", async ({
    page,
  }) => {
    await loginAs(page, "carrier");
    await page.goto(`/viajes/${E2E.rolesTripId}`);

    const row = cargoRow(page, E2E.cargo.owner.description);
    // el vencimiento lo manda el server (createdAt + 24 h), en hora de Argentina
    await expect(row).toContainText(
      /esperando la seña de la empresa \(vence \S+ \d{1,2}\/\d{1,2} \d{2}:\d{2}\)/
    );
    await expect(row.getByRole("button", { name: "confirmar carga" })).toHaveCount(0);
  });

  test("el fletero confirma la carga con seña", async ({ page }) => {
    await loginAs(page, "carrier");
    await page.goto(LIFECYCLE_TRIP);

    const row = cargoRow(page, paidPending.description);
    await row.getByRole("button", { name: "confirmar carga" }).click();
    await expect(row).toContainText("confirmada");
    await expect(row.getByRole("button", { name: "confirmar carga" })).toHaveCount(0);
  });
});
