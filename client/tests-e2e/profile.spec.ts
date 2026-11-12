import { test, expect, loginAs } from "./fixtures.ts";

/**
 * Perfil y solicitudes de viaje, con los usuarios del seed demo (empresa@ y
 * flete@): el login va por la API con el helper de R1, sin el formulario.
 */

test.describe("perfil de la empresa", () => {
  test("pide los datos de contacto", async ({ page }) => {
    await loginAs(page, "company");
    await page.goto("/perfil");
    await expect(page.getByText("cargá tus datos de contacto")).toBeVisible();
  });
});

test.describe("solicitudes de la empresa", () => {
  test("solo muestra las enviadas, sin pestañas", async ({ page }) => {
    await loginAs(page, "company");
    await page.goto("/solicitudes");
    await expect(page.getByText("pedidos que enviaste")).toBeVisible();
    await expect(page.getByText("recibidas")).not.toBeVisible();
  });

  test("solicitar viaje desde la lista de fleteros abre el modal", async ({ page }) => {
    await loginAs(page, "company");
    await page.goto("/fleteros");
    await page.getByRole("button", { name: "solicitar viaje" }).first().click();
    await expect(page.getByText("solicitar viaje a")).toBeVisible();
  });
});

test.describe("perfil del fletero", () => {
  test("muestra el interruptor de disponible ahora", async ({ page }) => {
    await loginAs(page, "carrier");
    await page.goto("/perfil");
    await expect(page.getByText("disponible ahora")).toBeVisible();
  });
});
