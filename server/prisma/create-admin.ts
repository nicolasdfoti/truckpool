// `npm run admin:create`: crea el admin de producción (también sirve en dev).
// Es el único camino a una cuenta ADMIN fuera del seed demo, que no corre en
// producción. Ver HELP para el uso.
//
// dotenv va primero: DATABASE_URL y las ADMIN_* pueden venir de server/.env.
import "dotenv/config";
import { createInterface } from "node:readline";
import { prisma } from "../lib/prisma.js";
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  AdminInputError,
  DEFAULT_ADMIN_NAME,
  createAdmin,
} from "./create-admin-lib.js";

const HELP = `uso: npm run admin:create

crea una cuenta ADMIN. Si el email ya existe, aborta sin tocar nada.

forma recomendada: correrlo sin variables y completar lo que pide. La
contraseña se escribe sin eco y no queda en ningún lado.

también lee estas variables (de la terminal o de server/.env):
  ADMIN_EMAIL     email del admin
  ADMIN_NAME      nombre visible (por defecto "${DEFAULT_ADMIN_NAME}")
  ADMIN_PASSWORD  al menos ${ADMIN_PASSWORD_MIN_LENGTH} caracteres. Evitala: pasada por variable
                  puede quedar en el historial de la terminal o en el entorno
                  del proceso. Usala solo donde no haya una terminal (por
                  ejemplo, un job de un solo uso del hosting).
`;

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** pide un dato sin mostrar lo que se escribe */
function askHidden(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  // readline no tiene un modo sin eco: se silencia su salida mientras se escribe
  const muted = rl as unknown as { _writeToOutput: (text: string) => void };
  let prompted = false;
  muted._writeToOutput = (text: string) => {
    if (!prompted) {
      process.stdout.write(text);
      prompted = true;
    }
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const fromEnv = {
    email: process.env.ADMIN_EMAIL?.trim() || undefined,
    name: process.env.ADMIN_NAME?.trim() || undefined,
    password: process.env.ADMIN_PASSWORD || undefined,
  };
  const interactive = Boolean(process.stdin.isTTY);
  if ((!fromEnv.email || !fromEnv.password) && !interactive) {
    console.error("faltan datos y no hay una terminal para pedirlos.\n");
    console.error(HELP);
    process.exitCode = 1;
    return;
  }
  if (fromEnv.password) {
    console.warn(
      "aviso: ADMIN_PASSWORD vino por variable. Lo recomendado es el prompt (ver --help)."
    );
  }

  const email = fromEnv.email ?? (await ask("email del admin: "));
  const name =
    fromEnv.name ??
    (interactive && !fromEnv.email
      ? (await ask(`nombre (enter = "${DEFAULT_ADMIN_NAME}"): `)).trim() || undefined
      : undefined);
  let password = fromEnv.password;
  if (!password) {
    password = await askHidden(
      `contraseña (al menos ${ADMIN_PASSWORD_MIN_LENGTH} caracteres): `
    );
    const again = await askHidden("repetila: ");
    if (again !== password) {
      throw new AdminInputError("las contraseñas no coinciden");
    }
  }

  const admin = await createAdmin({ email, password, ...(name ? { name } : {}) }, prisma);
  console.log(`admin creado: ${admin.email}`);
}

main()
  .catch((err) => {
    // un dato inválido se muestra tal cual; cualquier otro error, solo su nombre
    // (uno de Prisma puede traer los parámetros de la consulta)
    if (err instanceof AdminInputError) {
      console.error(`no se creó el admin: ${err.message}`);
    } else {
      console.error("no se creó el admin: error inesperado", {
        name: err instanceof Error ? err.name : typeof err,
        code: (err as { code?: unknown } | null)?.code,
      });
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
