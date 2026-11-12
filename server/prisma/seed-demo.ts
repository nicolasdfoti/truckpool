// Seed demo (solo desarrollo): `npm run db:seed:demo`. Con NODE_ENV=production
// aborta sin escribir nada; el admin de producción sale de `npm run admin:create`.
//
// dotenv va primero: así el guard ve también un NODE_ENV puesto en server/.env.
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { runDemoSeed } from "./demo-seed.js";

runDemoSeed(prisma)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
