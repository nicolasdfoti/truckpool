import type { Page } from "@playwright/test";
import { test, expect, loginAs, apiGet } from "./fixtures.ts";

/**
 * L7 / U16: /pagos/retorno muestra el estado real del pago, que lee del detalle
 * del viaje cada 3 s hasta 60 s, y nunca el `?status` que pone MP en la URL. El
 * detalle del viaje y la preference se interceptan en el navegador: el e2e no
 * necesita un pago real ni el webhook de MP.
 */

const TRIP_ID = "e2e-retorno";
const CARGO_ID = "e2e-retorno-carga";
const RETURN_URL = `/pagos/retorno?tripId=${TRIP_ID}&cargoItemId=${CARGO_ID}&type=DEPOSIT`;

type PaymentStatus = "PENDING" | "APPROVED" | "REJECTED";

function payment(type: "DEPOSIT" | "BALANCE", status: PaymentStatus, amount: number) {
  return {
    id: `pay-${type}`,
    type,
    status,
    amount,
    refundedAmount: null,
    platformFeeAmount: null,
    carrierAmount: null,
    netPlatformFeeAmount: null,
    netCarrierAmount: null,
  };
}

/** el detalle del viaje como lo ve la empresa dueña de la carga */
function tripDetail(
  cargo: {
    deposit?: PaymentStatus | null;
    balance?: PaymentStatus | null;
    status?: "PENDING" | "CONFIRMED";
    reservationExpiresAt?: string | null;
  } = {},
  { withCargo = true, companyId = "e2e-empresa" } = {}
) {
  return {
    id: TRIP_ID,
    origin: "Córdoba",
    destination: "Mendoza",
    date: "2026-12-20T00:00:00.000Z",
    departureTime: "08:00",
    truckType: "Semi",
    capacityTotal: 30,
    capacityUsed: 4,
    price: 3000,
    status: cargo.balance ? "IN_TRANSIT" : "OPEN",
    acceptsCargo: true,
    carrierId: "e2e-fletero",
    carrierName: "Transportes Flete",
    features: [],
    depositPercent: 20,
    platformFeePercent: 10,
    cargoCount: 1,
    viewerAccess: "PARTICIPANT",
    cargoItems: withCargo
      ? [
          {
            id: CARGO_ID,
            tripId: TRIP_ID,
            companyId,
            description: "E2E carga del retorno",
            volume: 4,
            priceShare: 400,
            depositAmount: 80,
            balanceAmount: 320,
            reservationExpiresAt: cargo.reservationExpiresAt ?? null,
            status: cargo.status ?? "PENDING",
            createdAt: "2026-11-13T12:00:00.000Z",
            cancelledAt: null,
            cancellationFeeAmount: null,
            cancellationReason: null,
            depositPayment: cargo.deposit ? payment("DEPOSIT", cargo.deposit, 80) : null,
            balancePayment: cargo.balance ? payment("BALANCE", cargo.balance, 320) : null,
            companyName: "Comercial Norte",
            pickupAddress: "E2E Calle Retorno 900, Córdoba",
            pickupLat: null,
            pickupLng: null,
            trackingCode: "TP-E2E-RET",
            stopOrder: 1,
          },
        ]
      : [],
    otherCargo: [],
    reviews: [],
    viewerReviewed: false,
  };
}

/**
 * Responde el detalle del viaje con `responses` en orden (el último se repite)
 * y devuelve cuántas veces se pidió.
 */
async function serveTrip(page: Page, responses: ReturnType<typeof tripDetail>[]) {
  const calls = { count: 0 };
  await page.route(`**/api/trips/${TRIP_ID}`, (route) => {
    const body = responses[Math.min(calls.count, responses.length - 1)];
    calls.count += 1;
    return route.fulfill({ json: body });
  });
  return calls;
}

test("approved en la URL pero el server todavía no: verifica y después acredita", async ({
  page,
}) => {
  const calls = await serveTrip(page, [
    tripDetail({ deposit: "PENDING" }),
    tripDetail({ deposit: "PENDING" }),
    tripDetail({ deposit: "APPROVED" }),
  ]);
  await loginAs(page, "company");
  // lo que pone MP en el redirect no se cree
  await page.goto(`${RETURN_URL}&status=approved&collection_status=approved`);

  await expect(
    page.getByRole("heading", { name: "estamos verificando tu pago" })
  ).toBeVisible();
  await expect(
    page.getByText("no cierres esta pestaña ni pagues de nuevo.")
  ).toBeVisible();

  // a los 3 s y 6 s vuelve a consultar; con la seña APPROVED, se acredita
  await expect(page.getByRole("heading", { name: "seña acreditada" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator("main")).toContainText(
    "reservaste 4 m³ en Córdoba → Mendoza. ahora el fletero tiene que confirmar tu carga; te avisamos por mail. el saldo de $ 320,00 se paga cuando el viaje sale."
  );
  // D1: la empresa ya no lee que puede confirmar
  await expect(page.locator("main")).not.toContainText("podés confirmar");
  await expect(page.getByRole("link", { name: "ver mi carga" })).toHaveAttribute(
    "href",
    `/viajes/${TRIP_ID}`
  );

  // acreditada, deja de consultar
  const after = calls.count;
  await page.waitForTimeout(4_000);
  expect(calls.count).toBe(after);
});

test("sigue PENDING a los 60 s: no se acreditó todavía y deja de consultar", async ({
  page,
}) => {
  await page.clock.install();
  const calls = await serveTrip(page, [tripDetail({ deposit: "PENDING" })]);
  await loginAs(page, "company");
  await page.goto(RETURN_URL);

  await expect(
    page.getByRole("heading", { name: "estamos verificando tu pago" })
  ).toBeVisible();
  // consulta cada 3 s
  const first = calls.count;
  await page.clock.runFor(3_100);
  await expect.poll(() => calls.count).toBeGreaterThan(first);

  await page.clock.fastForward(61_000);
  await expect(
    page.getByRole("heading", { name: "tu pago todavía no se acreditó" })
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "a veces Mercado Pago tarda unos minutos. te avisamos por mail apenas se acredite. no hace falta pagar de nuevo."
  );
  await expect(page.getByRole("link", { name: "volver al viaje" })).toBeVisible();

  const after = calls.count;
  await page.clock.runFor(10_000);
  expect(calls.count).toBe(after);
});

test("rechazado: no se cobró nada, hasta cuándo sigue el lugar y reintentar va a MP", async ({
  page,
}) => {
  const expires = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
  await serveTrip(page, [
    tripDetail({ deposit: "REJECTED", reservationExpiresAt: expires }),
  ]);
  const initPoint =
    "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=e2e-retry";
  let preferenceBody: unknown = null;
  await page.route(`**/api/cargo-items/${CARGO_ID}/payment-preference`, (route) => {
    preferenceBody = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json: {
        paymentId: "e2e",
        cargoItemId: CARGO_ID,
        type: "DEPOSIT",
        amount: 80,
        status: "PENDING",
        initPoint,
      },
    });
  });
  await page.route("https://www.mercadopago.com.ar/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>checkout e2e</h1>" })
  );
  await loginAs(page, "company");
  // MP dice approved, el server dice REJECTED: manda el server
  await page.goto(`${RETURN_URL}&status=approved`);

  await expect(
    page.getByRole("heading", { name: "Mercado Pago rechazó el pago" })
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    /no se cobró nada\. tu lugar sigue reservado hasta el \S+ \d{1,2}\/\d{1,2} \d{2}:\d{2}; podés intentar con otro medio\./
  );

  await page.getByRole("button", { name: "reintentar pago" }).click();
  await expect(page).toHaveURL(initPoint);
  expect(preferenceBody).toEqual({ type: "DEPOSIT" });
});

test("saldo pagado", async ({ page }) => {
  await serveTrip(page, [
    tripDetail({ deposit: "APPROVED", status: "CONFIRMED", balance: "APPROVED" }),
  ]);
  await loginAs(page, "company");
  await page.goto(
    `/pagos/retorno?tripId=${TRIP_ID}&cargoItemId=${CARGO_ID}&type=BALANCE`
  );

  await expect(page.getByRole("heading", { name: "saldo pagado" })).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "ya está todo pago. podés seguir el viaje desde el detalle."
  );
  await expect(page.getByRole("link", { name: "seguir el viaje" })).toBeVisible();
});

test.describe("entrando a mano (APP_URL local: MP no vuelve solo)", () => {
  test("sin parámetros, muestra el último pago mandado a MP desde este navegador", async ({
    page,
  }) => {
    await serveTrip(page, [tripDetail({ deposit: "APPROVED" })]);
    await page.addInitScript({
      content: `localStorage.setItem("truckpool_last_payment", ${JSON.stringify(
        JSON.stringify({
          tripId: TRIP_ID,
          cargoItemId: CARGO_ID,
          type: "DEPOSIT",
          savedAt: Date.now(),
        })
      )});`,
    });
    await loginAs(page, "company");
    await page.goto("/pagos/retorno");

    await expect(page.getByRole("heading", { name: "seña acreditada" })).toBeVisible();
  });

  test("al ir a pagar, el detalle guarda el pago para el retorno", async ({ page }) => {
    // el botón de pagar es solo de la empresa dueña de la carga: va su id real
    const { user } = await apiGet<{ user: { id: string } }>("/auth/me", "company");
    await serveTrip(page, [tripDetail({ deposit: null }, { companyId: user.id })]);
    await page.route(`**/api/cargo-items/${CARGO_ID}/payment-preference`, (route) =>
      route.fulfill({
        status: 201,
        json: {
          paymentId: "e2e",
          cargoItemId: CARGO_ID,
          type: "DEPOSIT",
          amount: 80,
          status: "PENDING",
          // vuelve a la app en vez de ir a MP, para leer el localStorage
          initPoint: "/pagos/retorno",
        },
      })
    );
    await loginAs(page, "company");
    await page.goto(`/viajes/${TRIP_ID}`);
    await page.getByRole("button", { name: /pagar seña/i }).click();

    await expect(page).toHaveURL("/pagos/retorno");
    const saved = await page.evaluate(() =>
      localStorage.getItem("truckpool_last_payment")
    );
    expect(JSON.parse(saved ?? "null")).toMatchObject({
      tripId: TRIP_ID,
      cargoItemId: CARGO_ID,
      type: "DEPOSIT",
    });
    await expect(
      page.getByRole("heading", { name: "estamos verificando tu pago" })
    ).toBeVisible();
  });

  test("sin parámetros ni pago guardado: no sabe qué pago es", async ({ page }) => {
    await loginAs(page, "company");
    await page.goto("/pagos/retorno");

    await expect(
      page.getByRole("heading", { name: "no encontramos el pago" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "ver mis cargas" })).toHaveAttribute(
      "href",
      "/perfil"
    );
  });

  test("sin sesión: pide ingresar", async ({ page }) => {
    await page.goto(RETURN_URL);
    await expect(
      page.getByRole("heading", { name: "ingresá para ver tu pago" })
    ).toBeVisible();
  });

  test("una carga que no es de quien mira: no muestra nada del pago", async ({
    page,
  }) => {
    await serveTrip(page, [tripDetail({}, { withCargo: false })]);
    await loginAs(page, "company");
    await page.goto(RETURN_URL);

    await expect(
      page.getByRole("heading", { name: "no pudimos ver este pago" })
    ).toBeVisible();
  });
});
