import { test, expect } from '@playwright/test';

test.describe('Profile page - 4 puntos', () => {
  test.beforeEach(async ({ page }) => {
    // Login as company first
    await page.goto('http://localhost:5174/ingresar');
    await page.fill('input[type="email"]', 'empresa@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/perfil');
  });

  test('1. Profile company copy y secciones', async ({ page }) => {
    await page.goto('http://localhost:5174/perfil');
    await page.waitForSelector('text=cargá tus datos de contacto');
    await page.screenshot({ path: '/tmp/opencode/1-profile-company.png', fullPage: true });
  });
});

test.describe('TripRequests - empresa solo enviadas', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5174/ingresar');
    await page.fill('input[type="email"]', 'empresa@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/perfil');
  });

  test('2. TripRequests empresa solo enviadas sin tabs', async ({ page }) => {
    await page.goto('http://localhost:5174/solicitudes');
    await page.waitForSelector('text=pedidos que enviaste');
    // No debería haber tabs
    await expect(page.locator('text=recibidas')).not.toBeVisible();
    await page.screenshot({ path: '/tmp/opencode/2-trip-requests-company.png', fullPage: true });
  });
});

test.describe('Solicitar viaje modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5174/ingresar');
    await page.fill('input[type="email"]', 'empresa@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/perfil');
  });

  test('3. Solicitar viaje desde CarrierProfile abre modal', async ({ page }) => {
    await page.goto('http://localhost:5174/fleteros');
    await page.waitForSelector('text=Solicitar viaje');
    await page.click('text=Solicitar viaje');
    await page.waitForSelector('text=solicitar viaje a');
    await page.screenshot({ path: '/tmp/opencode/3-solicitar-viaje-modal.png', fullPage: true });
  });
});

test.describe('Toggle disponible ahora', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5174/ingresar');
    await page.fill('input[type="email"]', 'carrier@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/perfil');
  });

  test('4. Toggle disponible ahora visible para carrier', async ({ page }) => {
    await page.goto('http://localhost:5174/perfil');
    await page.waitForSelector('text=disponible ahora');
    await page.screenshot({ path: '/tmp/opencode/4-toggle-availability.png', fullPage: true });
  });
});
