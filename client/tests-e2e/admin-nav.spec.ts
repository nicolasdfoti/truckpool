import type { Page } from "@playwright/test";
import { test, expect, USERS, loginAs, type E2EUser } from "./fixtures.ts";

/**
 * 03/Admin#3 (L9): el admin entra a su panel y lo tiene en la navegación.
 * Con un «volver» válido, el login respeta RD8 también para el admin.
 */
async function submitLogin(page: Page, email: string) {
  await page.getByLabel("email").fill(email);
  await page.getByLabel("contraseña").fill("truckpool123");
  await page.getByRole("button", { name: "entrar" }).click();
}

// «Admin», con o sin el contador de pendientes al lado
const ADMIN_LINK = /^Admin\b/;

test("el admin ingresa y cae en /admin", async ({ page }) => {
  await page.goto("/ingresar");
  await submitLogin(page, USERS.admin);
  await expect(page).toHaveURL("/admin");
});

test("el admin con «volver» vuelve a la página de origen", async ({ page }) => {
  await page.goto("/rastrear");
  await page.getByRole("banner").getByRole("link", { name: "ingresar" }).click();
  await expect(page).toHaveURL(/\/ingresar\?volver=%2Frastrear/);
  await submitLogin(page, USERS.admin);
  await expect(page).toHaveURL("/rastrear");
});

test("el admin ve «Admin» con las verificaciones pendientes", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/viajes");
  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  const link = nav.getByRole("link", { name: ADMIN_LINK });
  await expect(link).toHaveAttribute("href", "/admin");
  // el seed e2e deja al menos un fletero con la verificación pendiente
  await expect(link).toHaveAccessibleName(/^Admin \d+ verificaci(ón|ones) pendientes?$/);

  await link.click();
  await expect(page).toHaveURL("/admin");
  await expect(link).toHaveAttribute("aria-current", "page");
});

test("el admin ve «Admin» en el menú mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "admin");
  await page.goto("/viajes");
  await page.getByRole("button", { name: "abrir menú" }).click();
  const nav = page.getByRole("navigation", { name: "Navegación móvil" });
  await nav.getByRole("link", { name: ADMIN_LINK }).click();
  await expect(page).toHaveURL("/admin");
});

for (const role of ["company", "carrier"] as const satisfies readonly E2EUser[]) {
  test(`${role === "company" ? "la empresa" : "el fletero"} no ve «Admin»`, async ({
    page,
  }) => {
    await loginAs(page, role);
    await page.goto("/viajes");
    // el header ya resolvió la sesión: está el menú del usuario
    await expect(page.getByRole("button", { name: /^menú de / }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: ADMIN_LINK })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "abrir menú" }).click();
    await expect(
      page.getByRole("navigation", { name: "Navegación móvil" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: ADMIN_LINK })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Verificaciones" })).toHaveCount(0);
  });
}
