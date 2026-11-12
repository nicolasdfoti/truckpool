# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TruckPool is a shared-freight marketplace (Argentina): carriers (`CARRIER`) publish trips with spare truck capacity, companies (`COMPANY`) book m³ on them and pay a deposit + balance via Mercado Pago, `ADMIN` approves carrier identity verification. Two independent npm projects: `server/` (Express 5 API) and `client/` (React 19 SPA). There is no root package.json/workspace — run commands inside each folder. `README.md` (Spanish) has the full API table, env var list and design rationale.

**Language:** code comments, API error messages, UI copy and README are in Spanish (rioplatense, lowercase error messages like `"viaje no encontrado"`). Keep new user-facing strings and comments in Spanish to match.

## Commands

```bash
# Local infra (PostgreSQL on :5433, pgAdmin on :5051) — app itself is NOT in compose
docker compose up -d

# server/
npm run dev            # tsx watch src/index.ts → http://localhost:4000
npm test               # vitest run (all tests/**/*.test.ts)
npx vitest run tests/trips.service.test.ts          # single file
npx vitest run tests/trips.service.test.ts -t "nombre del test"   # single test
npm run typecheck      # tsc --noEmit
npm run lint
npm run format         # prettier
npx prisma migrate dev # schema lives at server/schema.prisma (not prisma/), migrations in prisma/migrations
npm run db:seed        # alias of db:seed:demo — demo users flete@ / empresa@ / admin@truckpool.app, password truckpool123; aborts with NODE_ENV=production
npm run db:seed:e2e    # extra users + fixed-id trips for Playwright (client global-setup runs it); also blocked in production
npm run db:seed:prod   # idempotent, creates no users
npm run admin:create   # production admin: prompts for email/password (≥ 16 chars); ADMIN_EMAIL/ADMIN_PASSWORD env also work but can land in shell history
npm run seed:geocode   # backfill coords for existing trips

# client/
npm run dev            # vite (5173 by default; Playwright specs assume 5174)
npm run build          # tsc -b && vite build — this is also the client typecheck
npm run lint
npx playwright test    # specs in tests-e2e/; no playwright config, needs app + API running
```

Server tests mock Prisma, Mercado Pago, Nominatim, OSRM routing and email per file with `vi.mock` — they need no database or network. `tests/setup.ts` pins `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY`. Rate limits are off under vitest; tests that exercise them set `RATE_LIMITS=on` (or `AUTH_RATE_LIMIT_MAX` for login/register) and re-import the app after `vi.resetModules()`. The client has no unit tests; validation is lint + build.

## Server architecture

- **Pipeline** (`src/app.ts`): helmet → json → cors → routers under `/api` (`API_PREFIX`) → 404 → error handler. `src/index.ts` is the bootstrap that loads `.env`. `lib/env.ts` aborts startup on missing/known-insecure secrets; in production it also requires the full MP/Resend/CORS/HTTPS-URL/`TRUST_PROXY` config and rejects `RATE_LIMITS=off`. `src/` only holds `app.ts` and `index.ts`; `lib/` and `modules/` live at the `server/` root (not under `src/`), so `lib/env.ts` means `server/lib/env.ts`.
- **Modules** (`modules/<name>/`): `*.routes.ts` (guard chain: `validateBody`/`validateQuery` Zod middleware, `requireAuth`, `requireRole`) → `*.controller.ts` (only req/res) → `*.service.ts` (business logic **and ownership checks**, never touches req/res) → Prisma. `*.schemas.ts` holds Zod schemas; don't re-validate in controllers. Note `users.routes.ts` also exports `carriersRouter` and `adminRouter`, and public tracking (`/api/tracking/:code`) is wired directly in `app.ts` to a trips controller. `paymentsRouter` is mounted at the `/api` root.
- **Errors**: throw an `AppError` subclass from `lib/errors.ts` (message, status, `code`). Express 5 forwards async throws; the handler returns `{ error, code }`. The client's `ApiError` exposes that `code` so the UI can branch on it — keep codes stable.
- **Serialization boundary**: every API response goes through `lib/mappers.ts`. Secrets (encrypted MP tokens) and exact coordinates stay hidden because the mapper omits them — add new fields there deliberately.
- **ESM with explicit `.js` extensions** in relative imports (`../lib/prisma.js`), even from `.ts` files.
- **Route order matters**: static paths like `/price-estimate` must be registered before `/:id`.
- Prisma 7 with `@prisma/adapter-pg` (`lib/prisma.ts`); config in `prisma.config.ts`.

### Domain invariants (don't break these)

- Money is `Decimal(12,2)`. `priceShare` is computed server-side from volume (`lib/pricing.ts`); the client sends m³, never prices.
- `capacityUsed` is not a column — it's derived by summing active `CargoItem.volume` (`activeVolume`/`isActiveCargo` in mappers).
- `addCargoItem` runs in a `Serializable` transaction with retry on `P2034`; keep capacity checks inside it.
- `depositAmount` is frozen at booking time.
- Cancellation penalty: >48 h free, 24–48 h half the deposit, <24 h full deposit (`lib/cancellation.ts`). The client doesn't recompute it: `client/src/lib/cancellation.ts` asks `GET /trips/:tripId/cargo-items/:cargoItemId/cancellation-quote` (U21: $ 0 if the deposit wasn't paid). The public `GET /trips/cancellation-quote` is unused and slated for removal in L11.
- Trip status `OPEN → FULL → IN_TRANSIT → COMPLETED`, or `CANCELLED` from OPEN/FULL (carrier cancels; active cargo is cancelled with the paid deposit refunded in full); cargo `PENDING → CONFIRMED | CANCELLED`; payment `PENDING → APPROVED | REJECTED → REFUNDED`, and `APPROVED → CHARGED_BACK` (final).
- Geocoding (Nominatim, 1 req/s queue, 24 h cache) and emails (Resend) are best-effort: failure must never block publishing a trip or a business operation. Coordinates are nullable on purpose.
- Only the `COMPANY` reviews, once per `COMPLETED` trip; the reviewee is always derived from the trip.

### Mercado Pago

`lib/mercadopago.ts` is the only place that touches the MP SDK and `MP_ACCESS_TOKEN`. Payments are created on the **carrier's** MP account (Marketplace OAuth, token AES-256-GCM encrypted via `lib/crypto.ts`) with a platform fee (`platformFeePercent`, default 10 %). Webhooks are verified with HMAC-SHA256 + `timingSafeEqual` and fail closed (503) without `MP_WEBHOOK_SECRET`. SDK errors are translated to sanitized codes (`MP_ERROR`, `MP_INVALID_RESPONSE`, `MP_NOT_CONFIGURED`) — never log raw SDK errors (they can carry auth headers). End-to-end payment testing needs a public HTTPS tunnel for `APP_URL`/`API_PUBLIC_URL`.

### Auth

JWT (7 days) with `jti`; `requireAuth` checks the `RevokedToken` table on every request (logout revokes). OAuth `state` is signed with purpose + 10 min expiry. Production admin accounts come from `npm run admin:create` (the demo seed's admin is dev-only).

## Client architecture

- `src/api/client.ts`: thin fetch wrapper (`api.get/post/patch/delete`), JWT in `localStorage` (`truckpool_token`), base URL from `VITE_API_URL` (default `http://localhost:4000/api`).
- `src/hooks/`: one TanStack Query hook per query/mutation; mutations invalidate the related queries. Pages mostly consume hooks (only `Login` still calls `api` directly).
- Routing lives in `src/main.tsx`.
- Tailwind v4 via `@tailwindcss/vite` — no `tailwind.config.js`, theme is in `src/index.css`.
- Maps (Leaflet) are lazy-loaded through `Lazy*Map` wrappers; stop reordering uses `@dnd-kit`.
- Routes are Spanish paths (e.g. `/ingresar`, `/viajes/:id`, `/fleteros`, `/rastrear`, `/pagos/retorno`, `/admin/verificaciones`).

## Formatting

Prettier (root `.prettierrc`): printWidth 90, double quotes, semicolons, trailing commas `es5`.

## Review
Findings live in docs/review/. Read them before re-analyzing the repo. Never read server/.env.