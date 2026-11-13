import { test, expect, E2E } from "./fixtures.ts";

/**
 * RD10 / QW8: un viaje o un fletero que no existen responden 404 al toque (sin
 * reintentos), con un mensaje distinto del error de carga y una salida; la
 * pestaña dice qué viaje es.
 */
test("un viaje que no existe: 404 sin reintentos, salida y título", async ({ page }) => {
  let hits = 0;
  page.on("request", (req) => {
    if (req.method() === "GET" && req.url().endsWith("/api/trips/rd10-no-existe")) hits++;
  });
  await page.goto("/viajes/rd10-no-existe");

  await expect(
    page.getByRole("heading", { name: "este viaje no existe o ya no está publicado" })
  ).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole("button", { name: "reintentar" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "ver viajes disponibles" })
  ).toHaveAttribute("href", "/viajes");
  await expect(page).toHaveTitle("Viaje no encontrado — TruckPool");
  expect(hits).toBe(1);
});

test("un error del server no es un 404: se puede reintentar", async ({ page }) => {
  let fail = true;
  await page.route(`**/api/trips/${E2E.rolesTripId}`, (route) =>
    fail
      ? route.fulfill({
          status: 500,
          json: { error: "error interno", code: "INTERNAL_ERROR" },
        })
      : route.fallback()
  );
  await page.goto(`/viajes/${E2E.rolesTripId}`);

  // un 5xx sí se reintenta (3 veces, con espera creciente) antes del mensaje
  await expect(
    page.getByRole("heading", { name: "no pudimos cargar este viaje" })
  ).toBeVisible({ timeout: 15000 });
  fail = false;
  await page.getByRole("button", { name: "reintentar" }).click();
  await expect(page).toHaveTitle(/→ .* — TruckPool$/);
});

test("el detalle de un viaje lleva origen → destino en la pestaña", async ({ page }) => {
  await page.goto(`/viajes/${E2E.rolesTripId}`);
  await expect(page).toHaveTitle(/^.+ → .+ — TruckPool$/);
  // y las demás rutas siguen con el suyo
  await page.goto("/viajes");
  await expect(page).toHaveTitle("Viajes abiertos — TruckPool");
});

test("un fletero que no existe: el mensaje sin esperar reintentos", async ({ page }) => {
  await page.goto("/fleteros/rd10-no-existe");
  await expect(page.getByText("no encontramos este transportista.")).toBeVisible({
    timeout: 3000,
  });
  await expect(page).toHaveTitle("Perfil del transportista — TruckPool");
});
