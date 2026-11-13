import { test, expect } from "./fixtures.ts";

/**
 * RD2 / QW5: la landing no contradice el producto que se lanza. La empresa no
 * publica carga (reserva lugar en un viaje), el precio es fijo por m³ y los
 * pagos ya existen.
 */
test("sin «MVP… Próximamente: Pagos» ni CTA que digan que la empresa publica", async ({
  page,
}) => {
  await page.goto("/");
  const body = page.locator("body");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const wrong of [
    /MVP/,
    /Próximamente/i,
    /PUBLICAR CARGA/,
    /ENCONTRAR CARGA/,
    /Negocia/,
  ]) {
    await expect(body).not.toContainText(wrong);
  }
});

test("cada CTA lleva a lo que hace cada rol", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator("section").first();
  // la empresa: el buscador (rediseño, hero 1) y el link a todos los viajes
  await expect(hero.getByRole("button", { name: "Buscar viajes" })).toBeVisible();
  await expect(
    hero.getByRole("link", { name: "todos los viajes publicados" })
  ).toHaveAttribute("href", "/viajes");
  // el fletero: en su pestaña
  await hero.getByRole("tab", { name: "Tengo un camión con lugar" }).click();
  await expect(hero.getByRole("link", { name: "Publicar mi viaje" })).toHaveAttribute(
    "href",
    "/viajes/nuevo"
  );
  await expect(
    page.getByRole("heading", { name: "Reservá y pagá la seña" })
  ).toBeVisible();
});

test("el buscador lleva origen, destino y fecha a /viajes", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Origen").fill("Córdoba");
  await page.getByLabel("Destino").fill("Rosario");
  await page.getByLabel("Desde el").fill("2026-12-01");
  await page.getByRole("button", { name: "Buscar viajes" }).click();
  await expect(page).toHaveURL(
    "/viajes?origen=C%C3%B3rdoba&destino=Rosario&desde=2026-12-01"
  );
});

test("las pestañas del hero se mueven con las flechas", async ({ page }) => {
  await page.goto("/");
  const empresa = page.getByRole("tab", { name: "Busco lugar para mi carga" });
  await empresa.focus();
  await page.keyboard.press("ArrowRight");
  const fletero = page.getByRole("tab", { name: "Tengo un camión con lugar" });
  await expect(fletero).toBeFocused();
  await expect(fletero).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Buscar viajes" })).toBeHidden();
});
