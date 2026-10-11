# Warehouse Console (frontend)

Next.js 16 App Router frontend for the Inventory Management System. The browser
talks only to the Next server (`/api/bff/*`, `/api/auth/*`); the BFF calls the
FastAPI backend server-to-server through `API_BASE_URL`, which is read on the
server only and never sent to the browser. See [`docs/DEMO.md`](docs/DEMO.md)
for LAN development and the demo walkthrough.

## Requirements

- Node.js 22, the version CI and the `Dockerfile` use.
- A running backend for `npm run dev` (default `http://localhost:8081`).

## Commands

Run from `frontend/`:

| Command | What it does |
|---|---|
| `npm ci` | Install the exact locked dependencies |
| `npm run dev` | Start the development server on port 3000 |
| `npm run typecheck` | Generate Next.js route types with `next typegen` (git-ignored output), then run the TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit and component tests (jsdom); never contacts a backend |
| `npm run build` | Production build with standalone output |
| `npm run check` | The four CI gates in order: typecheck, lint, test, build |

## Continuous integration

`.github/workflows/frontend.yml` runs the job **Frontend checks** on every pull
request to `main`, every push to `main`, merge-queue runs and manual dispatch:
`npm ci`, typecheck, lint, Vitest and `next build` on Node 22. It has no path
filters and no skip conditions, so it always reports a real result, and it needs
no secrets. Don't use `[skip ci]` on pull requests to `main`: a required check
would then stay pending.

## Live contract tests (opt-in, guarded)

`src/lib/api/schemas/live-contract.test.ts` checks the frontend's Zod schemas
against a real backend. Many of its requests change data, so it may only run
against a **disposable backend seeded for that run**, never a development, demo
or production one. `npm test` and CI always skip it.

`npm run test:live` switches it on, and `src/test/live-guard.ts` then refuses to
start unless all of these are set:

| Variable | Requirement |
|---|---|
| `LIVE_API_BASE_URL` | `http://127.0.0.1:18081`, `http://localhost:18081` or `http://[::1]:18081`, the disposable E2E API. `API_BASE_URL` is never used |
| `LIVE_RUN_ID` | 12–32 lowercase letters or digits, new for every run |
| `LIVE_MUTATION_CONSENT` | Exactly `mutate:<origin>:<LIVE_RUN_ID>`, with the origin written as above |
| `LIVE_USER`, `LIVE_PASS` | The per-run warehouse account `e2e_wh_<LIVE_RUN_ID>`; password at least 32 characters |
| `LIVE_ADMIN_USER`, `LIVE_ADMIN_PASS` | The per-run admin account `e2e_admin_<LIVE_RUN_ID>`; password at least 32 characters |

The per-area flags `LIVE_SALES_MUTATE`, `LIVE_PICKPACK_MUTATE`, `LIVE_PO_MUTATE`,
`LIVE_TRANSFER_MUTATE`, `LIVE_MASTER_MUTATE` and `LIVE_SHIP_MUTATE` additionally
switch on each area's round-trip tests.

Before the first request, the guard checks that `GET /health` identifies the
inventory API, that `GET /ready` reports ready, and that both per-run accounts
log in with the expected roles. Each request is sent at most once: it is never
retried, and any redirect (3xx) response is refused rather than followed, so the
suite calls canonical URLs only. A 15-second timer covers each request until its
response headers arrive; reading the response body is not covered by that timer
and is bounded only by the 30-second Vitest test and hook timeouts. The run
stops at the first failure.

These checks reduce the risk of reaching the wrong backend, but they do not
prove that the backend's database is isolated; that has to come from the
disposable environment itself. Until that environment exists (R0b), the live
suite is not expected to run.
