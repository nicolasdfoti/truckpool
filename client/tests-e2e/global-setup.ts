import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Antes de cada corrida: el seed e2e del server (usuarios extra y los viajes
 * con ids fijos de fixtures.ts) y un chequeo de que la API responde, para que
 * un server apagado falle acá con un mensaje claro y no en cada test.
 */
export default async function globalSetup() {
  const serverDir = fileURLToPath(new URL("../../server", import.meta.url));
  execSync("npm run db:seed:e2e", { cwd: serverDir, stdio: "inherit" });

  const res = await fetch(`${API_URL}/health`).catch(() => null);
  if (!res?.ok) {
    throw new Error(
      `la API no responde en ${API_URL}: levantala con \`npm run dev\` en server/`
    );
  }
}

const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000/api";
