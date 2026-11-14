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

// Repaso del gate (rediseño A): en Chromium, con el foco en el ícono del
// calendario el campo no matchea :focus-visible ni :focus, y no se veía nada
test("un campo de fecha: el anillo en todas sus partes, calendario incluido", async ({
  page,
}) => {
  await page.goto("/");
  const date = page.locator("input[name=desde]");
  // como texto: los e2e compilan sin los tipos del DOM
  const onDate = () =>
    page.evaluate<boolean>("document.activeElement?.getAttribute('name') === 'desde'");
  await date.focus();
  let stops = 0;
  // día, mes, año y el botón del calendario: el foco sigue en el mismo input
  while (stops < 6 && (await onDate())) {
    await expect(date).toHaveCSS("outline-style", "solid");
    await expect(date).toHaveCSS("outline-color", ACCENT_STRONG);
    stops++;
    await page.keyboard.press("Tab");
  }
  expect(stops).toBeGreaterThanOrEqual(4);
});

// el header es fijo. En el detalle a dos columnas, el Tab sale de «enviar» (al
// pie de la columna de la izquierda) y entra al panel «Tu carga», arriba a la
// derecha. Si el botón ya asomaba cortado por arriba, el navegador lo bajaba
// solo hasta el borde de la ventana, y ahí lo tapaba el header
test("lo que se enfoca no queda tapado por el header fijo", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(page, "company");
  // el viaje de roles: ningún e2e lo hace salir ni retira la carga de empresa@
  await page.goto(`/viajes/${E2E.rolesTripId}`);
  const withdraw = page.getByRole("button", { name: /^retirar carga/i }).first();
  await expect(withdraw).toBeVisible();
  // como texto: los e2e compilan sin los tipos del DOM
  await page.evaluate(`(() => {
    const buttons = [...document.querySelectorAll("button")];
    buttons.find((b) => b.textContent.trim() === "enviar").focus({ preventScroll: true });
    const target = buttons.find((b) => /^retirar carga/i.test(b.textContent.trim()));
    window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY + 20);
  })()`);
  await page.keyboard.press("Tab");
  await expect(withdraw).toBeFocused();
  const header = await page.getByRole("banner").boundingBox();
  const box = await withdraw.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
});
