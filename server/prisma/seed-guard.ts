/**
 * Los seeds con datos de prueba (demo y e2e) crean usuarios con contraseñas
 * públicas: con NODE_ENV=production no corren. Se llama antes de tocar la base.
 */
export function assertNotProduction(scriptName: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${scriptName} no corre con NODE_ENV=production`);
  }
}
