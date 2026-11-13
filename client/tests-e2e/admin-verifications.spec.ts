import { test, expect, loginAs, apiGet, apiToken, API_URL, E2E } from "./fixtures.ts";

/**
 * Admin#1: un pedido de verificación sin DNI/CUIT no se puede aprobar. La
 * pantalla deshabilita «aprobar» y dice por qué; el server lo rechaza igual si
 * alguien lo pide por API.
 */
const { email, name } = E2E.noTaxIdCarrier;

test("sin CUIT, «aprobar» está deshabilitado y dice por qué", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/admin/verificaciones");

  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toContainText("dni/cuit: no informado");
  const approve = row.getByRole("button", { name: "aprobar" });
  await expect(approve).toBeDisabled();
  await expect(approve).toHaveAccessibleDescription("sin CUIT no se puede aprobar");
  // rechazar sigue: es la forma de pedirle que lo cargue
  await expect(row.getByRole("button", { name: "rechazar" })).toBeEnabled();
});

test("el server no aprueba un pedido sin CUIT", async () => {
  const pending = await apiGet<{ id: string; email: string }[]>(
    "/admin/verifications",
    "admin"
  );
  const target = pending.find((item) => item.email === email);
  expect(target).toBeDefined();

  const res = await fetch(`${API_URL}/admin/verifications/${target!.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await apiToken("admin")}`,
    },
    body: JSON.stringify({ approve: true }),
  });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ code: "VERIFICATION_TAX_ID_MISSING" });

  // sigue pendiente
  const after = await apiGet<{ email: string }[]>("/admin/verifications", "admin");
  expect(after.map((item) => item.email)).toContain(email);
});
