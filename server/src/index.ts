// Tiene que ser el PRIMER import del proceso, antes de cualquier otro módulo.
// El orden importa: en ESM los imports se evalúan en el orden en que aparecen,
// y si otro módulo lee process.env al evaluarse (no dentro de una función), lo
// hace contra un entorno todavía vacío. Por eso `dotenv/config` vive acá y sólo
// acá: en el entrypoint, que es el único punto donde el orden está garantizado.
//
// No mover este import más abajo ni volver a ponerlo en lib/prisma.ts.
import "dotenv/config";
import { assertServerEnv } from "../lib/env.js";
import { app } from "./app.js";
import { startJobs } from "../lib/jobs.js";

assertServerEnv();

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => console.log(`server en :${PORT}`));

// Tareas periódicas: solo acá, nunca en app.ts (los tests importan la app).
// JOBS_ENABLED="false" las apaga; por defecto corren.
if (process.env.JOBS_ENABLED !== "false") {
  startJobs();
} else {
  console.log("jobs apagados (JOBS_ENABLED=false)");
}
