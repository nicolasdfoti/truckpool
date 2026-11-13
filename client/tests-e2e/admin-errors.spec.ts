import { test, expect, loginAs } from "./fixtures.ts";

/**
 * QW7: con un error del server, las pantallas de admin lo dicen y dejan
 * reintentar (antes: verificaciones en blanco y el dashboard con el «error
 * interno» crudo). Un 5xx se reintenta solo 3 veces antes del mensaje.
 */
for (const { path, api, message, ok } of [
  {
    path: "/admin/verificaciones",
    api: "**/api/admin/verifications",
    message: "no pudimos cargar las verificaciones pendientes.",
    ok: /verificaciones esperando revisión|dni\/cuit/,
  },
  {
    path: "/admin",
    api: "**/api/admin/stats",
    message: "no pudimos cargar las métricas.",
    ok: /viajes/i,
  },
]) {
  test(`${path}: error con reintentar`, async ({ page }) => {
    let fail = true;
    await page.route(api, (route) =>
      fail
        ? route.fulfill({
            status: 500,
            json: { error: "error interno", code: "INTERNAL_ERROR" },
          })
        : route.fallback()
    );
    await loginAs(page, "admin");
    await page.goto(path);

    const alert = page.getByRole("alert").filter({ hasText: message });
    await expect(alert).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("error interno")).toHaveCount(0);

    fail = false;
    await alert.getByRole("button", { name: "reintentar" }).click();
    await expect(alert).toBeHidden();
    await expect(page.locator("main")).toContainText(ok);
  });
}
