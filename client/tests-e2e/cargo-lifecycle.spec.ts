import type { Page } from "@playwright/test";
import { test, expect, loginAs, API_URL, E2E } from "./fixtures.ts";

/**
 * L7: el ciclo de la carga en el detalle del viaje, contra la API de verdad y
 * los viajes de server/prisma/seed-e2e.ts. Nada de lo que corre acá hace que el
 * server llame a Mercado Pago: solo se retira de verdad la carga sin seña, y lo
 * que es de MP (la preference) se intercepta en el navegador.
 *
 * Los tests van en orden y comparten el viaje: el seed lo deja como nuevo en
 * cada corrida (global-setup).
 */
test.describe.configure({ mode: "serial" });

const LIFECYCLE_TRIP = `/viajes/${E2E.lifecycleTripId}`;
const { unpaid, paidPending, confirmed } = E2E.lifecycleCargo;

/** la fila de una carga en «cargas del viaje», por su descripción */
function cargoRow(page: Page, description: string) {
  return page
    .getByRole("list", { name: "cargas del viaje" })
    .getByRole("listitem")
    .filter({ hasText: description });
}

/** "100,00": el monto como lo muestra la UI, sin el símbolo */
function amountText(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2 });
}

test.describe("retiro con diálogo propio (U21)", () => {
  test("carga confirmada con seña pagada: desglose, Escape cierra y el foco vuelve", async ({
    page,
  }) => {
    await loginAs(page, "company");
    await page.goto(LIFECYCLE_TRIP);

    const row = cargoRow(page, confirmed.description);
    const withdraw = row.getByRole("button", { name: "retirar carga" });
    await withdraw.click();

    const dialog = page.getByRole("dialog", { name: "¿retirar esta carga?" });
    await expect(dialog).toBeVisible();
    // foco inicial en el botón que no hace nada
    await expect(dialog.getByRole("button", { name: "mantener" })).toBeFocused();
    await expect(dialog).toContainText("el fletero ya la había confirmado");
    await expect(dialog).toContainText(
      `seña pagada$ ${amountText(confirmed.depositAmount)}`
    );
    // a 10 días de la salida: vuelve toda la seña, nada retenido
    await expect(dialog).toContainText(
      `te devolvemos$ ${amountText(confirmed.depositAmount)}`
    );
    await expect(dialog).not.toContainText("se retiene$");
    await expect(dialog).toContainText(
      "faltan más de 48 h para la salida: te devolvemos toda la seña."
    );
    await expect(dialog).toContainText("el reembolso lo procesa Mercado Pago");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(withdraw).toBeFocused();
    // no se retiró nada
    await expect(row).not.toContainText("retirada");
  });

  test("el Tab queda atrapado dentro del diálogo", async ({ page }) => {
    await loginAs(page, "company");
    await page.goto(LIFECYCLE_TRIP);
    await cargoRow(page, confirmed.description)
      .getByRole("button", { name: "retirar carga" })
      .click();

    const dialog = page.getByRole("dialog", { name: "¿retirar esta carga?" });
    const keep = dialog.getByRole("button", { name: "mantener" });
    const confirm = dialog.getByRole("button", { name: "retirar carga" });
    await expect(confirm).toBeEnabled();
    await expect(keep).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(keep).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirm).toBeFocused();

    await keep.click();
    await expect(dialog).toBeHidden();
  });

  test("carga sin seña: no hay nada que devolver y se retira de verdad", async ({
    page,
  }) => {
    await loginAs(page, "company");
    await page.goto(LIFECYCLE_TRIP);

    const row = cargoRow(page, unpaid.description);
    // «retirar carga» se lee como botón (outline danger), no como label
    await row.getByRole("button", { name: "retirar carga" }).click();

    const dialog = page.getByRole("dialog", { name: "¿retirar esta carga?" });
    await expect(dialog).toContainText(
      "todavía no pagaste la seña, así que no hay nada que devolver."
    );
    await expect(dialog).not.toContainText("te devolvemos");

    await dialog.getByRole("button", { name: "retirar carga" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("retirada");
    await expect(row).toContainText("retirada sin seña cobrada");
  });
});

test.describe("confirmar carga solo el fletero (D1)", () => {
  test("la empresa no ve «confirmar carga» ni con la seña pagada", async ({ page }) => {
    await loginAs(page, "secondCompany");
    await page.goto(LIFECYCLE_TRIP);

    const row = cargoRow(page, paidPending.description);
    await expect(row).toContainText("seña pagada");
    await expect(page.getByRole("button", { name: "confirmar carga" })).toHaveCount(0);
  });

  test("el fletero ve hasta cuándo espera la seña de una carga sin pagar", async ({
    page,
  }) => {
    await loginAs(page, "carrier");
    await page.goto(`/viajes/${E2E.rolesTripId}`);

    const row = cargoRow(page, E2E.cargo.owner.description);
    // el vencimiento lo manda el server (createdAt + 24 h), en hora de Argentina
    await expect(row).toContainText(
      /esperando la seña de la empresa \(vence \S+ \d{1,2}\/\d{1,2} \d{2}:\d{2}\)/
    );
    await expect(row.getByRole("button", { name: "confirmar carga" })).toHaveCount(0);
  });

  test("el fletero ve «confirmar carga» en la carga con seña", async ({ page }) => {
    await loginAs(page, "carrier");
    await page.goto(LIFECYCLE_TRIP);

    // la confirma desde «¿salís ahora?», más abajo
    await expect(
      cargoRow(page, paidPending.description).getByRole("button", {
        name: "confirmar carga",
      })
    ).toBeVisible();
  });
});

test.describe("pagar la seña (03/Pagar seña#2)", () => {
  const ROLES_TRIP = `/viajes/${E2E.rolesTripId}`;

  test("fletero sin MP: el error queda en la fila y el botón se deshabilita", async ({
    page,
  }) => {
    await page.route("**/api/cargo-items/*/payment-preference", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "el transportista de este viaje no tiene cuenta de Mercado Pago conectada",
          code: "MP_ACCOUNT_NOT_CONNECTED",
        }),
      })
    );
    await loginAs(page, "company");
    await page.goto(ROLES_TRIP);

    const row = cargoRow(page, E2E.cargo.owner.description);
    const pay = row.getByRole("button", { name: /pagar seña/ });
    await pay.click();

    await expect(row.getByRole("alert")).toContainText(
      /este viaje no puede recibir pagos por ahora\. tu lugar queda reservado hasta el \S+ \d{1,2}\/\d{1,2} \d{2}:\d{2}\./
    );
    await expect(pay).toBeDisabled();
  });

  test("otro error: el mensaje del server en la fila y se puede reintentar", async ({
    page,
  }) => {
    await page.route("**/api/cargo-items/*/payment-preference", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: "no pudimos conectar con Mercado Pago",
          code: "MP_ERROR",
        }),
      })
    );
    await loginAs(page, "company");
    await page.goto(ROLES_TRIP);

    const row = cargoRow(page, E2E.cargo.owner.description);
    const pay = row.getByRole("button", { name: /pagar seña/ });
    await pay.click();
    await expect(row.getByRole("alert")).toHaveText(
      "no pudimos conectar con Mercado Pago"
    );
    await expect(pay).toBeEnabled();
  });

  test("con la preference creada, va al checkout de MP (interceptado)", async ({
    page,
  }) => {
    const initPoint = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=e2e";
    await page.route("**/api/cargo-items/*/payment-preference", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          paymentId: "e2e-pay",
          cargoItemId: "e2e",
          type: "DEPOSIT",
          amount: 80,
          status: "PENDING",
          initPoint,
        }),
      })
    );
    // nunca sale a la red de MP
    await page.route("https://www.mercadopago.com.ar/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>checkout e2e</h1>" })
    );
    await loginAs(page, "company");
    await page.goto(ROLES_TRIP);

    await cargoRow(page, E2E.cargo.owner.description)
      .getByRole("button", { name: /pagar seña/ })
      .click();
    await expect(page).toHaveURL(initPoint);
    await expect(page.getByRole("heading", { name: "checkout e2e" })).toBeVisible();
  });
});

test.describe("antes de reservar y la reserva sin seña (03§1.2, 03§1.3)", () => {
  const ROLES_TRIP = `/viajes/${E2E.rolesTripId}`;

  test("resumen en vivo con la cotización del server y la política de retiro", async ({
    page,
  }) => {
    // lo que el server cobraría por 2,5 m³: el resumen tiene que decir lo mismo
    const res = await fetch(`${API_URL}/trips/${E2E.rolesTripId}/cargo-quote?volume=2.5`);
    const quote = (await res.json()) as {
      priceShare: number;
      depositAmount: number;
      balanceAmount: number;
    };

    await loginAs(page, "otherCompany");
    await page.goto(ROLES_TRIP);

    await expect(
      page.getByText("escribí el volumen y te mostramos cuánto pagás.")
    ).toBeVisible();
    await expect(page.getByText("reservás el lugar por 24 h.")).toContainText(
      "para confirmarlo pagás una seña del 20 %. si retirás la carga: más de 48 h antes de la salida te devolvemos toda la seña, entre 24 y 48 h la mitad, con menos de 24 h no hay devolución."
    );

    const quoteRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/cargo-quote")) quoteRequests.push(req.url());
    });
    await page.getByLabel("volumen (m³)").pressSequentially("2,5", { delay: 50 });
    await expect(page.getByText(/^2,5 m³:/)).toHaveText(
      `2,5 m³: $ ${amountText(quote.priceShare)}. hoy pagás la seña de $ ${amountText(
        quote.depositAmount
      )}; el saldo de $ ${amountText(quote.balanceAmount)} se paga cuando el viaje sale.`
    );
    // con debounce: escribir no pide una cotización por tecla
    expect(quoteRequests).toHaveLength(1);
  });

  test("la reserva sin seña dice hasta cuándo vale", async ({ page }) => {
    await loginAs(page, "company");
    await page.goto(ROLES_TRIP);

    const line = cargoRow(page, E2E.cargo.owner.description).getByText(
      /^reservado hasta/
    );
    await expect(line).toHaveText(
      /reservado hasta el \S+ \d{1,2}\/\d{1,2} \d{2}:\d{2}\. si no pagás la seña antes, el lugar se libera\./
    );
    // recién reservada (el seed corre antes de cada e2e): todavía no urge
    await expect(line).not.toHaveClass(/text-danger/);
  });

  test("faltando menos de 3 h, el vencimiento se pone en rojo", async ({ page }) => {
    // el vencimiento lo decide el server: acá se acerca en la respuesta
    await page.route(`**/api/trips/${E2E.rolesTripId}`, async (route) => {
      const response = await route.fetch();
      const trip = (await response.json()) as {
        cargoItems: { description: string; reservationExpiresAt: string | null }[];
      };
      for (const item of trip.cargoItems) {
        if (item.description === E2E.cargo.owner.description) {
          item.reservationExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        }
      }
      await route.fulfill({ response, json: trip });
    });
    await loginAs(page, "company");
    await page.goto(ROLES_TRIP);

    await expect(
      cargoRow(page, E2E.cargo.owner.description).getByText(/^reservado hasta/)
    ).toHaveClass(/text-danger/);
  });

  test("con la seña pagada, el saldo sigue a la vista", async ({ page }) => {
    await loginAs(page, "secondCompany");
    await page.goto(LIFECYCLE_TRIP);

    // 300 de la carga menos 60 de seña
    await expect(cargoRow(page, paidPending.description)).toContainText(
      `el saldo de $ ${amountText(240)} se paga cuando el viaje sale.`
    );
  });
});

test.describe("salir: «¿salís ahora?» y el checklist (D3)", () => {
  test("el checklist y el diálogo ofrecen confirmar la carga con seña antes de salir", async ({
    page,
  }) => {
    await loginAs(page, "carrier");
    await page.goto(LIFECYCLE_TRIP);

    // la sin seña de empresa@ ya se retiró arriba: quedan la confirmada, la que
    // tiene seña y la de e2e-otra@, sin seña ni confirmar
    const checklist = page.locator("p").filter({ hasText: "antes de salir:" });
    await expect(checklist).toContainText(
      "antes de salir: confirmá las cargas con seña pagada (1 de 2). las cargas sin confirmar se cancelan cuando marcás el viaje en tránsito, y a cada empresa le devolvemos la seña que haya pagado."
    );

    await page.getByRole("button", { name: "marcar en tránsito" }).click();
    const dialog = page.getByRole("dialog", { name: "¿salís ahora?" });
    await expect(dialog.getByRole("button", { name: "volver" })).toBeFocused();
    await expect(dialog).toContainText(
      `vas a llevar 1 carga confirmada (${confirmed.volume} m³).`
    );
    await expect(dialog).toContainText(
      "hay 2 cargas sin confirmar: si salís, se cancelan y a cada empresa le devolvemos la seña que haya pagado."
    );
    await expect(dialog.getByRole("button", { name: "salir con 1 carga" })).toBeVisible();

    // la confirma ahí mismo y el resumen se actualiza
    await dialog
      .getByRole("listitem")
      .filter({ hasText: paidPending.description })
      .getByRole("button", { name: "confirmar" })
      .click();
    await expect(dialog).toContainText(
      `vas a llevar 2 cargas confirmadas (${confirmed.volume + paidPending.volume} m³).`
    );
    // queda la que no tiene seña: esa no se puede confirmar
    await expect(dialog).toContainText(
      "hay 1 carga sin confirmar: si salís, se cancela y a cada empresa le devolvemos la seña que haya pagado."
    );
    await expect(dialog.getByRole("button", { name: "confirmar" })).toHaveCount(0);
    await expect(dialog).toContainText(
      "las empresas confirmadas van a recibir el aviso para pagar el saldo."
    );

    // volver no sale
    await dialog.getByRole("button", { name: "volver" }).click();
    await expect(dialog).toBeHidden();
    await expect(checklist).toContainText("(2 de 2)");
    await expect(page.getByText("abierto", { exact: true })).toBeVisible();
  });

  test("salir con las cargas confirmadas", async ({ page }) => {
    await loginAs(page, "carrier");
    await page.goto(LIFECYCLE_TRIP);

    await page.getByRole("button", { name: "marcar en tránsito" }).click();
    const dialog = page.getByRole("dialog", { name: "¿salís ahora?" });
    await dialog.getByRole("button", { name: "salir con 2 cargas" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("en viaje", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "marcar completado" })).toBeVisible();
    await expect(page.getByText("antes de salir:")).toHaveCount(0);
    // la que no estaba confirmada no viaja, y lo dice (L7)
    const noViaja = cargoRow(page, "E2E ciclo sin confirmar");
    await expect(noViaja).toContainText("cancelada");
    await expect(noViaja).toContainText(
      "cancelada porque el viaje salió sin confirmarla. no se había cobrado la seña."
    );
    await expect(noViaja).not.toContainText("retirada");
  });
});

test.describe("etiqueta de las cargas canceladas según el motivo (L7)", () => {
  test("cada motivo con su etiqueta, y «retirada» solo si la retiró la empresa", async ({
    page,
  }) => {
    await loginAs(page, "carrier");
    await page.goto(LIFECYCLE_TRIP);

    const casos: [string, string, string][] = [
      [unpaid.description, "retirada", "retirada sin seña cobrada"],
      [
        "E2E ciclo sin confirmar",
        "cancelada",
        "cancelada porque el viaje salió sin confirmarla. no se había cobrado la seña.",
      ],
      ["E2E ciclo vencida", "vencida", "venció la reserva: no se pagó la seña a tiempo."],
      [
        "E2E ciclo devuelta por el fletero",
        "cancelada",
        "cancelada: el fletero devolvió la seña entera desde Mercado Pago.",
      ],
      // de antes del motivo: no se inventa la causa
      ["E2E ciclo cancelada sin motivo", "cancelada", "cancelada sin seña cobrada"],
    ];
    for (const [description, etiqueta, nota] of casos) {
      const row = cargoRow(page, description);
      await expect(row.getByText(etiqueta, { exact: true })).toBeVisible();
      await expect(row).toContainText(nota);
    }
  });
});

test.describe("lo que se retuvo de la seña (RD5)", () => {
  test("con montos: cuánto se retuvo y cuánto se devolvió", async ({ page }) => {
    // una retirada con seña cobrada y retención, simulada sobre la respuesta
    // del viaje: retirar de verdad con seña haría que el server llame a MP
    await page.route(`**/api/trips/${E2E.lifecycleTripId}`, async (route) => {
      const response = await route.fetch();
      const trip = (await response.json()) as {
        cargoItems: Record<string, unknown>[];
      };
      for (const item of trip.cargoItems) {
        if (item.description === "E2E ciclo cancelada sin motivo") {
          item.cancellationReason = "COMPANY_WITHDREW";
          item.depositAmount = 42;
          item.cancellationFeeAmount = 21;
          item.depositPayment = { id: "e2e", type: "DEPOSIT", status: "REFUNDED" };
        }
        if (item.description === "E2E ciclo devuelta por el fletero") {
          item.cancellationReason = null;
          item.depositAmount = 30;
          item.cancellationFeeAmount = 30;
          item.depositPayment = { id: "e2e", type: "DEPOSIT", status: "APPROVED" };
        }
      }
      await route.fulfill({ response, json: trip });
    });
    await loginAs(page, "carrier");
    await page.goto(LIFECYCLE_TRIP);

    await expect(cargoRow(page, "E2E ciclo cancelada sin motivo")).toContainText(
      "retirada: se retuvieron $ 21,00 de la seña y se devolvieron $ 21,00."
    );
    await expect(cargoRow(page, "E2E ciclo devuelta por el fletero")).toContainText(
      "cancelada: se retuvo toda la seña ($ 30,00)."
    );
  });
});

test.describe("cancelar el viaje (D6)", () => {
  const CANCEL_TRIP = `/viajes/${E2E.cancelTripId}`;

  test("con el viaje en camino ya no se cancela", async ({ page }) => {
    await loginAs(page, "carrier");
    await page.goto(LIFECYCLE_TRIP);
    await expect(page.getByRole("button", { name: "marcar completado" })).toBeVisible();
    await expect(page.getByRole("button", { name: "cancelar viaje" })).toHaveCount(0);
  });

  test("el diálogo cuenta a cuántas empresas se les devuelve la seña", async ({
    page,
  }) => {
    // dos empresas con la seña pagada: se simula en la respuesta del viaje para
    // no cancelar de verdad algo que el server tendría que devolver a MP
    await page.route(`**/api/trips/${E2E.rolesTripId}`, async (route) => {
      const response = await route.fetch();
      const trip = (await response.json()) as {
        cargoItems: { status: string; depositPayment: unknown }[];
      };
      for (const item of trip.cargoItems) {
        if (item.status === "PENDING") {
          item.depositPayment = {
            id: "e2e",
            type: "DEPOSIT",
            status: "APPROVED",
            amount: 1,
            refundedAmount: null,
            platformFeeAmount: null,
            carrierAmount: null,
            netPlatformFeeAmount: null,
            netCarrierAmount: null,
          };
        }
      }
      await route.fulfill({ response, json: trip });
    });
    await loginAs(page, "carrier");
    await page.goto(`/viajes/${E2E.rolesTripId}`);

    await page.getByRole("button", { name: "cancelar viaje" }).click();
    const dialog = page.getByRole("dialog", { name: "¿cancelar el viaje?" });
    await expect(dialog).toContainText("se cancelan las 2 cargas activas del viaje.");
    await expect(dialog).toContainText("se devuelve el 100 % de la seña a 2 empresas.");
    await dialog.getByRole("button", { name: "volver" }).click();
    await expect(dialog).toBeHidden();
  });

  test("cancelar de verdad: la carga se cancela y el viaje queda cancelado", async ({
    page,
  }) => {
    await loginAs(page, "carrier");
    await page.goto(CANCEL_TRIP);

    const open = page.getByRole("button", { name: "cancelar viaje" });
    await open.click();
    const dialog = page.getByRole("dialog", { name: "¿cancelar el viaje?" });
    await expect(dialog.getByRole("button", { name: "volver" })).toBeFocused();
    await expect(dialog).toContainText("se cancela la carga activa del viaje.");
    await expect(dialog).toContainText(
      "ninguna empresa pagó la seña todavía: no hay nada que devolver."
    );

    // la parada de la carga activa, antes de cancelar
    const stops = page.getByRole("region", { name: "paradas del viaje" });
    await expect(stops).toContainText("E2E carga del viaje a cancelar");

    // Escape no cancela nada
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByText("abierto", { exact: true })).toBeVisible();

    await open.click();
    await dialog.getByRole("button", { name: "cancelar viaje" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("cancelado", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "marcar en tránsito" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "cancelar viaje" })).toHaveCount(0);
    // la carga no la retiró la empresa: se canceló con el viaje (L7)
    const row = cargoRow(page, "E2E carga del viaje a cancelar");
    await expect(row.getByText("cancelada", { exact: true })).toBeVisible();
    await expect(row).toContainText(
      "cancelada porque se canceló el viaje. no se había cobrado la seña."
    );
    await expect(row).not.toContainText("retirada");
    // RD4: las paradas se actualizan sin recargar (antes quedaba la cancelada
    // como «pendiente» y arrastrable)
    await expect(
      page.getByText("este viaje no tiene paradas de retiro cargadas.")
    ).toBeVisible();
    await expect(page.getByText(/arrastrá los ítems/)).toHaveCount(0);
  });
});
