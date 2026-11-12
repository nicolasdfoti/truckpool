import { defineConfig, devices } from "@playwright/test";

/**
 * e2e contra la app de verdad (R1). La API no la levanta Playwright: tiene que
 * estar corriendo en :4000 (`npm run dev` en server/, con JOBS_ENABLED="false")
 * y con http://localhost:5174 en CORS_ORIGIN. El client sí: se levanta en 5174
 * o se reusa el que ya esté corriendo ahí.
 */
export default defineConfig({
  testDir: "./tests-e2e",
  // los tests comparten los datos del seed e2e: en serie, sin pisarse
  workers: 1,
  fullyParallel: false,
  globalSetup: "./tests-e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
