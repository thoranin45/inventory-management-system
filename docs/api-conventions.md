# API conventions (V1)

All endpoints are under `/api/v1`. `/health`, `/ready` and `/metrics` live at
the root.

## Authentication

- Obtain a token: `POST /api/v1/auth/token` (OAuth2 password form, used by the
  Swagger **Authorize** button) or `POST /api/v1/auth/login` (JSON body).
- Send it as `Authorization: Bearer <token>` on every other request.
- Tokens are JWT, `HS256`, with `iat` and `exp`. Default lifetime is
  **720 minutes (12h)**, configurable via `ACCESS_TOKEN_EXPIRE_MINUTES`.
- There are no refresh tokens in V1. Re-authenticate when a token expires.
- **Current user:** `GET /api/v1/auth/me` → `{ id, username, role, is_active }`.
  Use this to bootstrap the frontend session and drive role-based UI.
- Authorization reloads the database user on every request. Disabling an
  account (`users.is_active = false`) or changing its role takes effect
  immediately, including for tokens already issued.
- Roles: `ADMIN` (full), `WAREHOUSE` (operational). A disabled or
  unknown-role account gets `403`.

## Error envelope

Every non-2xx response (including validation and unexpected errors) is:

```json
{
  "success": false,
  "message": "human readable summary",
  "errors": [{ "field": "quantity", "message": "...", "error_type": "..." }],
  "request_id": "0f9c1a2b3c4d5e6f0f9c1a2b3c4d5e6f"
}
```

- `422` — request validation; `errors[]` has one entry per bad field.
- `400 / 404 / 409` — typed business errors; `message` is safe to show.
- `429` — rate limited; a `Retry-After` header (seconds) is included.
- `500` — unexpected. `message` is always generic (`"Internal server error"`);
  no stack trace, SQL, or connection detail is ever returned. Correlate with
  server logs via `request_id`.

## Request IDs

- Every response carries `X-Request-ID`.
- If the caller sends a sane `X-Request-ID` (8–128 chars, `[A-Za-z0-9_.-]`), it
  is preserved end to end; otherwise the server generates one.
- On errors, the same id appears in the response body (`request_id`) and in the
  server access/error logs.

## Pagination

List endpoints accept `page` (>= 1) and `page_size` (>= 1) and return:

```json
{
  "success": true,
  "message": "...",
  "data": {
    "items": [ ... ],
    "pagination": { "page": 1, "page_size": 20, "total_items": 137, "total_pages": 7 }
  }
}
```

Some list endpoints also accept `search=` and `sort=` (see the endpoint's
OpenAPI entry).

## Quantities and money are fixed-scale strings

To avoid float drift, quantity and money fields are serialised as
**strings at a fixed scale**, not numbers:

- quantities: 3 decimal places, e.g. `"2.000"`, `"10.500"`
- money / amounts: 2 decimal places, e.g. `"6.00"`, `"1250.00"`

Send them the same way (string or number both accepted on input); always
render the string you receive rather than re-formatting a parsed float.

## Idempotency-Key

Receiving operations that must not double-apply accept an `Idempotency-Key`
header:

- `POST /api/v1/purchase-orders/{id}/receive`
- `POST /api/v1/inventory-transfers/{id}/receive`

Send a unique key (e.g. a UUID) per logical receipt. A retry with the **same**
key returns the original result without applying stock movements again. A
different key is treated as a new receipt.

## Lifecycles

- **Sales order:** `DRAFT → CONFIRMED → PICKING → PACKING → READY_TO_SHIP →
  SHIPPED` (`CANCELLED` from pre-ship states). Picking/packing can be driven by
  barcode via `POST .../scan-pick` and `.../scan-pack`.
- **Purchase order:** `DRAFT → CONFIRMED → (PARTIALLY_RECEIVED)* → RECEIVED`
  (`CANCELLED` before full receipt). Receipts are idempotent (see above).
- **Inventory transfer:** `DRAFT → DISPATCHED → (PARTIALLY_RECEIVED)* →
  RECEIVED` (`CANCELLED` only while `DRAFT`). Stock in transit is held on a
  protected transit balance and is not operationally available.

## Health / readiness / metrics

- `GET /health` — liveness. No DB. Always 200 while the process runs.
- `GET /ready` — readiness. 200 only if the DB answers **and** its Alembic
  revision equals the revision this build expects. Otherwise `503` with
  `reason` = `db_unreachable` or `migration_mismatch`.
- `GET /api/v1/health/` — legacy alias, kept for existing clients.
- `GET /metrics` — Prometheus text, **admin only**. Low-cardinality counters
  (no per-path/per-id labels).

## CORS

Explicit origin allow-list (`CORS_ORIGINS`), `allow_credentials=true`, no
wildcard. Allowed methods and headers are configured
(`Authorization, Content-Type, Idempotency-Key, X-Request-ID`). `X-Request-ID`
is exposed to browser clients.
