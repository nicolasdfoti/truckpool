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
  await expect(
    hero.getByRole("link", { name: "Buscar un viaje para mi carga" })
  ).toHaveAttribute("href", "/viajes");
  await expect(hero.getByRole("link", { name: "Publicar mi viaje" })).toHaveAttribute(
    "href",
    "/viajes/nuevo"
  );
  await expect(page.getByText("RESERVÁ Y PAGÁ LA SEÑA")).toBeVisible();
});
