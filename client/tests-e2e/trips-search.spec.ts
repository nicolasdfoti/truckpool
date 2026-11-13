import { test, expect } from "./fixtures.ts";

/**
 * Rediseño: el buscador de la landing manda origen, destino y fecha a /viajes
 * por la URL. El listado los toma como filtros y los vuelve a escribir cuando
 * cambian.
 */
test("/viajes toma origen, destino y fecha de la URL y filtra con ellos", async ({
  page,
}) => {
  const request = page.waitForRequest(
    (r) => r.url().includes("/api/trips?") && r.method() === "GET"
  );
  await page.goto("/viajes?origen=C%C3%B3rdoba&destino=Rosario&desde=2026-12-01");
  const url = new URL((await request).url());
  expect(url.searchParams.get("origin")).toBe("Córdoba");
  expect(url.searchParams.get("destination")).toBe("Rosario");
  expect(url.searchParams.get("dateFrom")).toBe("2026-12-01");

  await expect(page.getByLabel("Origen")).toHaveValue("Córdoba");
  await expect(page.getByLabel("Destino")).toHaveValue("Rosario");
  await expect(page.getByLabel("Desde el")).toHaveValue("2026-12-01");
});

test("cambiar un filtro lo deja en la URL; limpiar los saca", async ({ page }) => {
  await page.goto("/viajes");
  await page.getByLabel("Origen").fill("Mendoza");
  await expect(page).toHaveURL("/viajes?origen=Mendoza");
  await page.getByRole("button", { name: "Limpiar filtros" }).first().click();
  await expect(page).toHaveURL("/viajes");
  await expect(page.getByLabel("Origen")).toHaveValue("");
});

test("una fecha mal formada en la URL no se usa", async ({ page }) => {
  await page.goto("/viajes?desde=mañana");
  await expect(page.getByLabel("Desde el")).toHaveValue("");
  await expect(page).toHaveURL("/viajes");
});
