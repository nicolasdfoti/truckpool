# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests-e2e\profile.spec.ts >> TripRequests - empresa solo enviadas >> 2. TripRequests empresa solo enviadas sin tabs
- Location: tests-e2e\profile.spec.ts:29:3

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: page.waitForURL: Test timeout of 30000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/perfil" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e4]:
  - link "TruckPool - Inicio" [ref=e5] [cursor=pointer]:
    - /url: /
    - generic [ref=e8]: TruckPool
  - generic [ref=e9]:
    - button "acceder" [ref=e10]
    - button "crear cuenta" [ref=e11]
  - generic [ref=e12]:
    - generic [ref=e13]:
      - text: email
      - textbox "email" [ref=e14]:
        - /placeholder: vos@empresa.com
        - text: empresa@test.com
    - generic [ref=e15]:
      - text: contraseña
      - textbox "contraseña" [ref=e16]:
        - /placeholder: mínimo 8 caracteres
        - text: password123
    - paragraph [ref=e17]: Failed to fetch
    - button "entrar" [active] [ref=e18]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Profile page - 4 puntos', () => {
  4  |   test.beforeEach(async ({ page }) => {
  5  |     // Login as company first
  6  |     await page.goto('http://localhost:5174/ingresar');
  7  |     await page.fill('input[type="email"]', 'empresa@test.com');
  8  |     await page.fill('input[type="password"]', 'password123');
  9  |     await page.click('button[type="submit"]');
  10 |     await page.waitForURL('**/perfil');
  11 |   });
  12 | 
  13 |   test('1. Profile company copy y secciones', async ({ page }) => {
  14 |     await page.goto('http://localhost:5174/perfil');
  15 |     await page.waitForSelector('text=cargá tus datos de contacto');
  16 |     await page.screenshot({ path: '/tmp/opencode/1-profile-company.png', fullPage: true });
  17 |   });
  18 | });
  19 | 
  20 | test.describe('TripRequests - empresa solo enviadas', () => {
  21 |   test.beforeEach(async ({ page }) => {
  22 |     await page.goto('http://localhost:5174/ingresar');
  23 |     await page.fill('input[type="email"]', 'empresa@test.com');
  24 |     await page.fill('input[type="password"]', 'password123');
  25 |     await page.click('button[type="submit"]');
> 26 |     await page.waitForURL('**/perfil');
     |                ^ Error: page.waitForURL: Test timeout of 30000ms exceeded.
  27 |   });
  28 | 
  29 |   test('2. TripRequests empresa solo enviadas sin tabs', async ({ page }) => {
  30 |     await page.goto('http://localhost:5174/solicitudes');
  31 |     await page.waitForSelector('text=pedidos que enviaste');
  32 |     // No debería haber tabs
  33 |     await expect(page.locator('text=recibidas')).not.toBeVisible();
  34 |     await page.screenshot({ path: '/tmp/opencode/2-trip-requests-company.png', fullPage: true });
  35 |   });
  36 | });
  37 | 
  38 | test.describe('Solicitar viaje modal', () => {
  39 |   test.beforeEach(async ({ page }) => {
  40 |     await page.goto('http://localhost:5174/ingresar');
  41 |     await page.fill('input[type="email"]', 'empresa@test.com');
  42 |     await page.fill('input[type="password"]', 'password123');
  43 |     await page.click('button[type="submit"]');
  44 |     await page.waitForURL('**/perfil');
  45 |   });
  46 | 
  47 |   test('3. Solicitar viaje desde CarrierProfile abre modal', async ({ page }) => {
  48 |     await page.goto('http://localhost:5174/fleteros');
  49 |     await page.waitForSelector('text=Solicitar viaje');
  50 |     await page.click('text=Solicitar viaje');
  51 |     await page.waitForSelector('text=solicitar viaje a');
  52 |     await page.screenshot({ path: '/tmp/opencode/3-solicitar-viaje-modal.png', fullPage: true });
  53 |   });
  54 | });
  55 | 
  56 | test.describe('Toggle disponible ahora', () => {
  57 |   test.beforeEach(async ({ page }) => {
  58 |     await page.goto('http://localhost:5174/ingresar');
  59 |     await page.fill('input[type="email"]', 'carrier@test.com');
  60 |     await page.fill('input[type="password"]', 'password123');
  61 |     await page.click('button[type="submit"]');
  62 |     await page.waitForURL('**/perfil');
  63 |   });
  64 | 
  65 |   test('4. Toggle disponible ahora visible para carrier', async ({ page }) => {
  66 |     await page.goto('http://localhost:5174/perfil');
  67 |     await page.waitForSelector('text=disponible ahora');
  68 |     await page.screenshot({ path: '/tmp/opencode/4-toggle-availability.png', fullPage: true });
  69 |   });
  70 | });
  71 | 
```