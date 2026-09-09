# Warehouse Console — Demo & LAN development guide

> **DEV / DEMO ONLY.** Nothing here targets production. Every seed helper is
> guarded by `SEED_CONFIRM=1` and there is **no hidden production fallback** —
> a helper that is run without an explicit dev database refuses and exits.

The browser only ever talks to **Next / the BFF** (`/api/bff/*`, `/api/auth/*`).
It never calls FastAPI directly, so LAN access needs only the Next port open.

---

## 1. Run the frontend for LAN access

The FastAPI backend and Postgres are reached **server-to-server** by the BFF, so
they stay on `localhost` / an internal address. Only the Next dev server needs to
be reachable from other devices.

```bash
# from inventory-system/frontend
# API_BASE_URL is read ONLY on the server (BFF) — it is never sent to the browser.
API_BASE_URL=http://127.0.0.1:8081 npm run dev -- --hostname 0.0.0.0 --port 3000
```

Then from another device on the same LAN:

```
http://<PC-LAN-IP>:3000
```

Find `<PC-LAN-IP>` with `ipconfig` (look for the IPv4 address of the active
adapter, e.g. `192.168.1.x`).

### Windows Firewall

`next dev --hostname 0.0.0.0` binds all interfaces; Windows will usually prompt
to *Allow access* on first run — allow it for **Private networks**. If it was
dismissed, add an inbound rule manually:

```powershell
New-NetFirewallRule -DisplayName "Warehouse Console dev (Next 3000)" `
  -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

Nothing needs to be opened for FastAPI (8081) or Postgres (5432) — no browser
request reaches them.

### Notes

- No `localhost` / API host is hard-coded in any browser-visible request
  (verified: the only `fetch()` calls in browser code target the relative
  `/api/bff/*` and `/api/auth/*` paths).
- When TLS is terminated by a reverse proxy later, set `COOKIE_SECURE=1` and make
  the proxy forward `X-Forwarded-Proto: https` — the session cookie (`wc_session`,
  HttpOnly) is then marked `Secure`.
- `npm run build && npm run start -- --hostname 0.0.0.0 --port 3000` works the
  same way for a production-like local run.

---

## 2. Demo accounts

| Account | Username | Password | Role |
|---|---|---|---|
| Admin | `wc_admin` | `Admin123!` | `admin` |
| Warehouse | `wc_wh` | `Warehouse123!` | `warehouse` |

Credentials live **only** in the seed helper / this document — never in frontend
source. Rotate them for any shared demo deployment.

### Capabilities

**Both roles (backend `require_warehouse`)** — read every list/detail screen;
run picking, packing and receiving; dispatch/receive transfers; **ship** an
order and **return** items; download every report / workbook; view barcodes,
QR codes, labels and invoices.

**Admin only (backend `require_admin`)** — create / edit / deactivate Products;
create / edit / delete Categories, Customers, Suppliers; create + confirm
Purchase Orders and Sales Orders; **Complete** a shipped Sales Order; the
**Audit** screen (`/audit`).

**Warehouse restrictions surfaced in the UI** — no "New …" / edit / delete
buttons on Products / master-data; no Confirm on POs/SOs; no Complete on a
shipped order; no Audit nav item (a direct visit shows an "Admins only" screen,
and the endpoint itself returns 403). Every hidden action is still enforced by
the backend.

---

## 3. Repeatable demo data

All helpers are ORM-safe, idempotent-ish (skip existing rows by natural key) and
require `SEED_CONFIRM=1`.

### 3.1 Base: accounts + products + stock  *(required)*

```bash
# from inventory-system/  (venv active, .env / .env.api present)
SEED_CONFIRM=1 venv/Scripts/python.exe scratchpad/qa/bootstrap_live.py
```

Seeds:
- the two demo accounts above;
- one warehouse + location;
- **6 products** with a spread of tracking modes (batch+expiry, batch-only,
  non-batch) and stock thresholds;
- **batches** covering *healthy*, *near-expiry* and *expired*;
- **stock balances** with reserved quantities so operational-available differs
  from owned.

This alone demonstrates: healthy stock, **low stock** (`WH-SUGAR-25KG`,
on-hand 62 < min 80), **expired stock** (`LOT-2404-EXP`), **near-expiry**
(three batches), and the owned / operational-available / reserved / expired /
near-expiry breakdown on Products and the Operational-stock report.

### 3.2 Top-up: order / PO / transfer states  *(optional)*

```bash
SEED_CONFIRM=1 venv/Scripts/python.exe scratchpad/qa/seed_demo.py
```

Uses the **public backend API** (not raw SQL) to create a spread of:
- Sales orders in `DRAFT`, `CONFIRMED`, `READY_TO_SHIP`, `SHIPPED`, `COMPLETED`,
  `CANCELLED`;
- Purchase orders in `DRAFT`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED`;
- an inventory transfer driven `DRAFT → IN_TRANSIT → PARTIALLY_RECEIVED → COMPLETED`
  plus a `DRAFT` and a `CANCELLED` one.

Each created record is prefixed so it is obvious in the UI, and every write goes
through the same auth + validation path the app uses — so it also populates the
**Audit log** and **Reports** with realistic rows.

### 3.3 Fresh start

There is no destructive reset helper in this repo. To rebuild the demo DB from
empty, drop & recreate the dev database, run the backend migrations, then §3.1
and §3.2. (The QA scripts under `scratchpad/qa/` — `p6`…`p10` `verify.cjs` — also
leave the DB in a rich, valid state if run once.)

---

## 4. Quick demo script (≈5 min)

1. **Login** as `wc_admin`. Dashboard shows KPIs, attention items, recent activity.
2. **Products** → open `WH-SUGAR-25KG` → point out *Low stock* health + the
   owned vs operational-available breakdown; open `Green Tea 200g` → batches with
   `ExpiryBadge`, upload an image, *View QR* / *Open label (PDF)*.
3. **Purchase Orders** → create one, confirm, open the **receiving console**,
   receive a partial line, **reload the page** — the `Idempotency-Key` and the
   draft survive — then finish receiving.
4. **Sales** → create an order, confirm, → **Picking** → scan a line (show a wrong
   scan and an over-scan being rejected), complete picking → **Packing** →
   complete → **Shipping** → open the document block → **Ship** (auto
   `SHIP-000NNN`) → **Return** part of it → **Complete** (admin).
5. **Transfers** → create, **Dispatch all**, show *System transit*, partial
   receive, reload, final receive → `COMPLETED`; show that an expired batch
   cannot be dispatched.
6. **Reports** → Operational stock, Expired, Low stock, Movement history; export
   the Stock workbook (`.xlsx`).
7. **Audit** (`/audit`, admin only) → every action above is logged.
8. Sign in as `wc_wh` → show the same screens with create/confirm/complete/audit
   removed, and a 403 on a direct `/audit` visit.
