import { test, expect, loginAs, E2E } from "./fixtures.ts";

/**
 * QW10: al reordenar paradas con el teclado, el lector de pantalla oye las
 * instrucciones y los movimientos en español y con la dirección, no «Draggable
 * item cmw… was moved over…». Se cancela con Escape: el orden no se guarda.
 */
test("instrucciones y anuncios del arrastre en español", async ({ page }) => {
  await loginAs(page, "carrier");
  await page.goto(`/viajes/${E2E.rolesTripId}`);

  const stops = page.getByRole("region", { name: "paradas del viaje" });
  const handles = stops.getByRole("button", { name: /^mover / });
  await expect(handles).toHaveCount(2);
  const first = handles.first();
  await expect(first).toHaveAccessibleDescription(
    /^para mover una parada, apretá espacio/
  );

  const live = page.locator('[id^="DndLiveRegion"]');
  await first.focus();
  await page.keyboard.press("Space");
  // la región guarda el último anuncio: el «agarraste…» lo pisa enseguida este
  await expect(live).toContainText(/va a la posición 1 de 2\./);
  await page.keyboard.press("ArrowDown");
  await expect(live).toContainText(/va a la posición 2 de 2\./);
  await page.keyboard.press("Escape");
  await expect(live).toContainText(
    /cancelaste el movimiento: .* quedó en la posición 1\./
  );
  await expect(live).not.toContainText(/Draggable|droppable/);
});
