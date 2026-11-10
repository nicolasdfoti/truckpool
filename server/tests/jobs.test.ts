import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { processPendingRefunds } from "../modules/payments/refunds.service.js";
import { JOBS, runJob, startJobs, type Job } from "../lib/jobs.js";

// El scheduler: cada job se prueba llamándolo directo (sin timers); los timers
// falsos se usan solo para el arranque (`startJobs`).

vi.mock("../modules/payments/refunds.service.js", () => ({
  processPendingRefunds: vi.fn().mockResolvedValue({ retomadas: 0, procesadas: 0 }),
}));

const AHORA = new Date("2026-11-10T12:00:00.000Z");

function job(run: Job["run"], name = "prueba", intervalMs = 60_000): Job {
  return { name, intervalMs, run: vi.fn(run) };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe("JOBS", () => {
  it("el outbox de reembolsos corre cada minuto con processPendingRefunds", async () => {
    const refunds = JOBS.find((j) => j.name === "refunds");
    expect(refunds?.intervalMs).toBe(60_000);

    await refunds!.run(AHORA);
    expect(processPendingRefunds).toHaveBeenCalledWith(AHORA);
  });

  it("cada job tiene un nombre único", () => {
    const names = JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("runJob", () => {
  it("corre el job con la hora que recibe", async () => {
    const j = job(async () => {});
    expect(await runJob(j, AHORA)).toBe("ran");
    expect(j.run).toHaveBeenCalledWith(AHORA);
  });

  it("un job que lanza no rompe: loguea solo el job, el name y el code del error", async () => {
    const err = Object.assign(new Error("token APP_USR-secreto en el mensaje"), {
      code: "MP_ERROR",
    });
    const j = job(async () => {
      throw err;
    });

    expect(await runJob(j, AHORA)).toBe("failed");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls[0]);
    expect(logged).toContain("prueba");
    expect(logged).toContain("MP_ERROR");
    expect(logged).toContain("Error");
    expect(logged).not.toContain("APP_USR-secreto");
  });

  it("un error que no es un Error (ni tiene code) tampoco rompe", async () => {
    const j = job(() => {
      throw "texto suelto con datos";
    });
    expect(await runJob(j, AHORA)).toBe("failed");
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain("datos");
  });

  it("no se solapa consigo mismo: si la corrida anterior sigue, la nueva se saltea", async () => {
    let release!: () => void;
    const j = job(() => new Promise<void>((resolve) => (release = resolve)));

    const first = runJob(j, AHORA);
    expect(await runJob(j, AHORA)).toBe("skipped");
    expect(j.run).toHaveBeenCalledTimes(1);

    release();
    expect(await first).toBe("ran");

    // terminada la anterior, vuelve a correr
    const third = runJob(j, AHORA);
    release();
    expect(await third).toBe("ran");
    expect(j.run).toHaveBeenCalledTimes(2);
  });

  it("después de un error el job vuelve a correr", async () => {
    const j = job(async () => {
      throw new Error("x");
    });
    expect(await runJob(j, AHORA)).toBe("failed");
    expect(await runJob(j, AHORA)).toBe("failed");
    expect(j.run).toHaveBeenCalledTimes(2);
  });

  it("dos jobs distintos sí corren a la vez", async () => {
    let release!: () => void;
    const slow = job(() => new Promise<void>((resolve) => (release = resolve)), "lento");
    const other = job(async () => {}, "otro");

    const pending = runJob(slow, AHORA);
    expect(await runJob(other, AHORA)).toBe("ran");
    release();
    await pending;
  });
});

describe("startJobs", () => {
  it("arma un intervalo por job y cada uno corre a su ritmo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
    const fast = job(async () => {}, "rapido", 60_000);
    const slow = job(async () => {}, "lento", 5 * 60_000);

    const stop = startJobs([fast, slow]);
    // no corre nada al arrancar
    expect(fast.run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fast.run).toHaveBeenCalledTimes(5);
    expect(slow.run).toHaveBeenCalledTimes(1);
    expect(slow.run).toHaveBeenCalledWith(new Date(AHORA.getTime() + 5 * 60_000));

    stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fast.run).toHaveBeenCalledTimes(5);
  });

  it("un job que falla en cada vuelta no frena a los demás ni a sí mismo", async () => {
    vi.useFakeTimers();
    const broken = job(async () => {
      throw new Error("x");
    }, "roto");
    const ok = job(async () => {}, "sano");

    const stop = startJobs([broken, ok]);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    stop();

    expect(broken.run).toHaveBeenCalledTimes(3);
    expect(ok.run).toHaveBeenCalledTimes(3);
  });

  it("un intervalo que llega con la corrida anterior en curso no la duplica", async () => {
    vi.useFakeTimers();
    const slow = job(() => new Promise<void>((resolve) => setTimeout(resolve, 150_000)));

    const stop = startJobs([slow]);
    // vueltas a 1, 2 y 3 min: la de 1 min sigue hasta los 3:30
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    stop();

    expect(slow.run).toHaveBeenCalledTimes(1);
  });
});
