import type { Page } from "@playwright/test";
import { test, expect, loginAs } from "./fixtures.ts";

/**
 * QW18: una solicitud pendiente cuya fecha ya llegó (hoy o antes, en Argentina)
 * se marca «vencida» y no ofrece «aceptar», que el server rechaza desde L5.
 * «rechazar» queda: es la forma de sacarla de la lista. Las solicitudes se
 * interceptan: el seed e2e no crea ninguna.
 */
const DAY = 24 * 3600 * 1000;

function request(id: string, origin: string, desiredDate: Date) {
  return {
    id,
    origin,
    destination: "Tucumán 1545, CABA",
    desiredDate: desiredDate.toISOString(),
    estimatedVolume: 12,
    note: null,
    status: "PENDING",
    resultingTripId: null,
    createdAt: new Date(Date.now() - 20 * DAY).toISOString(),
    company: { id: "qw18-empresa", name: "Empresa de prueba" },
    carrier: { id: "qw18-fletero", name: "Transportes Flete" },
  };
}

async function serveRequests(page: Page, kind: "received" | "sent") {
  await page.route(`**/api/users/trip-requests/${kind}`, (route) =>
    route.fulfill({
      json: [
        request("qw18-vencida", "Origen vencido", new Date(Date.now() - 2 * DAY)),
        request("qw18-vigente", "Origen vigente", new Date(Date.now() + 10 * DAY)),
      ],
    })
  );
}

function row(page: Page, origin: string) {
  return page.getByRole("listitem").filter({ hasText: origin });
}

test("el fletero: la vencida sin «aceptar», con «rechazar»", async ({ page }) => {
  await serveRequests(page, "received");
  await loginAs(page, "carrier");
  await page.goto("/solicitudes");

  const expired = row(page, "Origen vencido");
  await expect(expired.getByText("vencida", { exact: true })).toBeVisible();
  await expect(expired).toContainText("la fecha ya llegó: no se puede aceptar.");
  await expect(expired.getByRole("button", { name: "aceptar" })).toHaveCount(0);
  await expect(expired.getByRole("button", { name: "rechazar" })).toBeVisible();

  const current = row(page, "Origen vigente");
  await expect(current.getByText("pendiente", { exact: true })).toBeVisible();
  await expect(current.getByRole("button", { name: "aceptar" })).toBeVisible();
});

test("la empresa ve su solicitud vencida como vencida", async ({ page }) => {
  await serveRequests(page, "sent");
  await loginAs(page, "company");
  await page.goto("/solicitudes");

  const expired = row(page, "Origen vencido");
  await expect(expired.getByText("vencida", { exact: true })).toBeVisible();
  await expect(expired).toContainText("ya no se puede aceptar");
  await expect(
    row(page, "Origen vigente").getByText("pendiente", { exact: true })
  ).toBeVisible();
});
