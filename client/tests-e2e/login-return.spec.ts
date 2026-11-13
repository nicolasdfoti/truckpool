import type { Page } from "@playwright/test";
import { test, expect, USERS, E2E } from "./fixtures.ts";

/**
 * RD8: ingresar desde una página vuelve a esa página (el viaje que se iba a
 * reservar, el retorno del pago), y solo a rutas internas.
 */
async function submitLogin(page: Page, email: string) {
  await page.getByLabel("email").fill(email);
  await page.getByLabel("contraseña").fill("truckpool123");
  await page.getByRole("button", { name: "entrar" }).click();
}

test("«ingresar» desde un viaje vuelve al viaje", async ({ page }) => {
  await page.goto(`/viajes/${E2E.rolesTripId}`);
  // el link de «sumar carga», no el del header
  await page.locator("form").getByRole("link", { name: "ingresar", exact: true }).click();
  await expect(page).toHaveURL(/\/ingresar\?volver=/);

  await submitLogin(page, USERS.company);
  await expect(page).toHaveURL(`/viajes/${E2E.rolesTripId}`);
  await expect(
    page.getByRole("heading", { name: "sumar carga a este viaje" })
  ).toBeVisible();
});

test("el retorno del pago sin sesión vuelve con su query", async ({ page }) => {
  const back = `/pagos/retorno?tripId=${E2E.rolesTripId}&cargoItemId=rd8&type=DEPOSIT`;
  await page.goto(back);
  await expect(
    page.getByRole("heading", { name: "ingresá para ver tu pago" })
  ).toBeVisible();
  await page.getByRole("link", { name: "ingresar", exact: true }).click();
  await submitLogin(page, USERS.company);
  await expect(page).toHaveURL(back);
});

test("un «volver» a otro sitio se ignora", async ({ page }) => {
  await page.goto("/ingresar?volver=//ejemplo.com/robar");
  await submitLogin(page, USERS.company);
  await expect(page).toHaveURL("/viajes");
});
