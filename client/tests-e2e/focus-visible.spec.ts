import type { Locator } from "@playwright/test";
import { test, expect, loginAs, E2E } from "./fixtures.ts";

/**
 * QW16: lo que se enfoca con teclado lleva el anillo de accent-strong (2 px,
 * separado 2 px). Antes los links tenían el outline de 1 px del navegador y
 * los inputs solo cambiaban el borde.
 */
const ACCENT_STRONG = "rgb(194, 95, 13)";

async function expectRing(locator: Locator) {
  await expect(locator).toBeFocused();
  await expect(locator).toHaveCSS("outline-style", "solid");
  await expect(locator).toHaveCSS("outline-width", "2px");
  await expect(locator).toHaveCSS("outline-color", ACCENT_STRONG);
  await expect(locator).toHaveCSS("outline-offset", "2px");
}

test("login: link, inputs y botón con el anillo", async ({ page }) => {
  await page.goto("/ingresar");

  // el primer Tab cae en un link del header
  await page.keyboard.press("Tab");
  const link = page.locator("a:focus");
  await expect(link).toHaveCount(1);
  await expectRing(link);

  await page.getByLabel("email").focus();
  await expectRing(page.getByLabel("email"));
  await page.keyboard.press("Tab");
  await expectRing(page.getByLabel("contraseña"));

  // después de la contraseña viene «entrar»
  await page.keyboard.press("Tab");
  const submit = page.getByRole("button", { name: "entrar" });
  await expectRing(submit);
});

test("un diálogo: el anillo en sus botones", async ({ page }) => {
  await loginAs(page, "carrier");
  await page.goto(`/viajes/${E2E.rolesTripId}`);
  await page.getByRole("button", { name: "marcar en tránsito" }).press("Enter");

  const dialog = page.getByRole("dialog", { name: "¿salís ahora?" });
  await expect(dialog).toBeVisible();
  // abierto con teclado: el foco inicial ya se ve
  await expectRing(dialog.getByRole("button", { name: "volver" }));
  await page.keyboard.press("Tab");
  await expectRing(dialog.locator(":focus"));

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
