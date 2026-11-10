import { AppError } from "./errors.js";
import { processPendingRefunds } from "../modules/payments/refunds.service.js";
import {
  autoCancelUndepartedTrips,
  releaseExpiredReservations,
} from "../modules/trips/trips.service.js";

/**
 * Scheduler de tareas periódicas, en el mismo proceso de la API.
 *
 * Lo arranca `src/index.ts` (nunca `app.ts`: los tests importan la app y no
 * pueden quedar con timers corriendo). Asume una sola instancia (ver §4 de
 * docs/review/04-launch.md); igual, cada job reclama su trabajo con CAS en la
 * base, así que dos corridas a la vez no hacen nada dos veces.
 *
 * Reglas de cada job:
 * - `run` recibe la hora de la corrida y se exporta desde su service, para
 *   testearlo llamándolo directo, sin timers.
 * - Un job no se solapa consigo mismo: si la corrida anterior sigue en curso,
 *   la vuelta se saltea (`runJob`).
 * - Ningún error de un job tumba el proceso ni frena a los demás: se loguea
 *   solo el nombre del job y el `name`/`code` del error, nunca el mensaje
 *   (puede traer datos de MP o de la base).
 */
export type Job = {
  name: string;
  intervalMs: number;
  run: (now: Date) => Promise<unknown>;
};

const MINUTE_MS = 60_000;

export const JOBS: Job[] = [
  // U12: outbox de reembolsos (PROCESSING colgados y PENDING con backoff vencido)
  { name: "refunds", intervalMs: MINUTE_MS, run: processPendingRefunds },
  // reservas PENDING sin seña vencidas a las 24 h (FULL→OPEN en la misma TX)
  { name: "reservations", intervalMs: MINUTE_MS, run: releaseExpiredReservations },
  // D6: viajes OPEN/FULL que no salieron 24 h después de la salida
  {
    name: "auto-cancel-trips",
    intervalMs: 5 * MINUTE_MS,
    run: autoCancelUndepartedTrips,
  },
  // L9: renovar los tokens de MP de los fleteros va acá como un job más
  // (`{ name: "mp-token-refresh", intervalMs, run }`), con su CAS en la base.
];

/** jobs con una corrida en curso (por identidad del job) */
const running = new Set<Job>();

export type JobOutcome = "ran" | "skipped" | "failed";

/** Corre una vuelta del job. Nunca lanza. */
export async function runJob(job: Job, now: Date = new Date()): Promise<JobOutcome> {
  if (running.has(job)) return "skipped";
  running.add(job);
  try {
    await job.run(now);
    return "ran";
  } catch (err) {
    console.error("[jobs] falló una corrida", {
      job: job.name,
      name: err instanceof Error ? err.name : typeof err,
      code: errorCode(err),
    });
    return "failed";
  } finally {
    running.delete(job);
  }
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof AppError) return err.code;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Un setInterval por job. La primera vuelta es a un intervalo del arranque.
 * Devuelve la función que los para.
 */
export function startJobs(jobs: Job[] = JOBS): () => void {
  const timers = jobs.map((job) => {
    const timer = setInterval(() => void runJob(job), job.intervalMs);
    // no retiene el proceso: lo que lo mantiene vivo es el server
    timer.unref();
    return timer;
  });
  return () => timers.forEach((timer) => clearInterval(timer));
}
