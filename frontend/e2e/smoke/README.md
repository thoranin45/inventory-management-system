# End-to-end smoke suite (P8)

Playwright tests that drive the real app in a browser:
Next.js + BFF → FastAPI → PostgreSQL. They are separate from the R5
simulation harness (`playwright.fulfillment.config.ts`, `e2e/fulfillment-*`).

| Spec | What it proves |
| --- | --- |
| `auth.setup.ts` | Creates the WAREHOUSE user if missing; signs in both roles through the login page and saves their sessions. |
| `login.spec.ts` | Signed-out redirect, wrong password refused (no cookie), admin login via BFF with an HttpOnly cookie, browser never calls FastAPI directly, sign-out. |
| `stock-in.spec.ts` | Warehouse receives a new lot with a 3-decimal quantity; server balance matches. |
| `stock-out-fefo.spec.ts` | FEFO issues the earliest-expiring lot first (the later-expiring lot is received first, so "oldest received" would fail); the server refuses an over-issue and deducts nothing. |
| `adjustment-approve.spec.ts` | Warehouse submits an adjustment, stock does not move; admin approves and stock changes once. |
| `sales-return-retry.spec.ts` | The first return request reaches the server but its response is dropped; Retry resends the same `Idempotency-Key` and stock goes up exactly once. |
| `responsive.spec.ts` | 390 / 768 / 1280 px × light / dark × Thai / English on Dashboard, Stock, Stock In and Sales: right language and theme, no sideways scroll, bottom tab bar on phones and side navigation from 768 px. |

Each test creates its own products and orders with unique SKUs, so the suite
can run more than once against the same database. It runs with one worker.

The tests use FastAPI directly only to **arrange** data and to **read** the
authoritative balances afterwards. Every flow under test goes through the
browser.

## In CI

`.github/workflows/e2e.yml`, job **Playwright smoke (E2E)**. It runs on every
pull request and every push to `main`, on a fresh PostgreSQL. It runs
migrations, creates the first admin with `scripts/create_first_admin.py`
(random password, masked), starts the API and `next start`, then runs the
suite. On failure it prints the server logs and uploads the HTML report and
traces as the `e2e-report` artifact for 7 days.

It is **not a required check**. Making it required means changing the
`main-protection` ruleset, which needs separate Owner approval.

## Locally

You need a migrated, disposable database and both servers running. **Never
point this at production.**

```bash
# backend (repo root), against a throwaway database
alembic upgrade head
ADMIN_USERNAME=e2e-admin ADMIN_PASSWORD=<12+ chars> python scripts/create_first_admin.py
AUTH_RATE_LIMIT_MAX_REQUESTS=1000 uvicorn app.main:app --host 127.0.0.1 --port 8081

# frontend
cd frontend
npm run build
API_BASE_URL=http://127.0.0.1:8081 npx next start -H 127.0.0.1 -p 3000

# tests (another shell, in frontend/)
npx playwright install chromium
E2E_ADMIN_USERNAME=e2e-admin E2E_ADMIN_PASSWORD=<same> npm run test:e2e
```

Optional environment variables:

- `E2E_BASE_URL`: the app. Default `http://127.0.0.1:3000`.
- `E2E_API_URL`: FastAPI. Default `http://127.0.0.1:8081/api/v1`.
- `E2E_WAREHOUSE_USERNAME` / `E2E_WAREHOUSE_PASSWORD`: the warehouse user to create or reuse.
- `E2E_CHROMIUM_PATH`: use an already-installed Chromium.
