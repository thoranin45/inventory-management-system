# Demo deployment

A throwaway, single-host demo of the Warehouse Console, reachable from a phone
over the public Internet through **Tailscale Funnel** — a stable `*.ts.net`
hostname with automatic HTTPS, no custom domain, and no inbound database or API
ports.

```
 iPhone / iPad / laptop (anywhere)
        │  HTTPS
        ▼
 Tailscale Funnel        (host process; terminates TLS at the edge)
        │  http://127.0.0.1:8080
        ▼
 nginx  (compose: 127.0.0.1:8080 → :80)   demo reverse proxy, loopback-only
        │  http://frontend:3000
        ▼
 Next.js 16 + BFF        (server-only route handlers; HttpOnly wc_session cookie)
        │  http://api:8081        (private compose network)
        ▼
 FastAPI / uvicorn --proxy-headers        (no host port, no auto-migrate)
        │
        ▼
 PostgreSQL 18           (named volume, no host port)
```

Everything is additive and separate from the production files:
`compose.demo.yml`, `nginx/demo.conf`, `.env.demo.example`,
`frontend/Dockerfile`, `scripts/seed_demo.py`. `compose.prod.yml`,
`nginx/default.conf` and `Dockerfile` are untouched.

## What this is not

- Not production. `ENV=production` only turns on the config safety gate; there
  is no backup cron, no monitoring, no HA, no real customer data.
- Not a permanent URL. The `*.ts.net` name is stable for as long as the host and
  the Funnel process stay up; tear it down when the demo is over.
- **Do not** use a random `*.trycloudflare.com` Cloudflare Quick Tunnel as the
  demo URL. It is acceptable only for a few minutes of throwaway testing and
  must never be handed out as "the demo link". A Cloudflare *named* tunnel needs
  a real Cloudflare-managed zone — out of scope here.

---

## Prerequisites

- A Linux (or macOS) host with Docker Engine + Compose v2 and `git`.
- Tailscale installed and logged in on that host (`tailscale up`), with
  **Funnel enabled for the tailnet** in the admin console
  (Access controls → Funnel node attribute) and MagicDNS + HTTPS certificates
  turned on.
- Outbound Internet from the host. **No inbound firewall changes** — Funnel
  makes the outbound connection itself.

Throughout, `<sha>` is the short commit you are deploying
(`git rev-parse --short HEAD`) and `<host>.<tailnet>.ts.net` is this host's
Funnel hostname (`tailscale status --json | jq -r .Self.DNSName` — drop the
trailing dot).

Every `docker compose -f compose.demo.yml …` command below reads variables
(the pinned image tags) from `.env.demo`. Compose does not pick that file up
automatically, so export it once per shell:

```bash
export COMPOSE_ENV_FILES=.env.demo      # compose v2.24+
# older compose: add `--env-file .env.demo` to each `docker compose` call
```

---

## Steps

### 1. Get the code at the demo revision

```bash
git clone <repo-url> inventory-demo && cd inventory-demo
git checkout deploy/demo-v0.1        # or the tag/branch you are demoing
git rev-parse --short HEAD           # note this as <sha>
```

### 2. Create the demo environment file

```bash
cp .env.demo.example .env.demo
chmod 600 .env.demo
export COMPOSE_ENV_FILES=.env.demo      # so `docker compose` reads it (see above)
```

`.env.demo` is git-ignored. It is the **only** place secrets live. The example
file contains placeholders only.

### 3. Generate a SECRET_KEY

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Put the output in `.env.demo` as `SECRET_KEY=...`. It must be ≥ 32 non-placeholder
characters or the API refuses to start.

### 4. Generate the database password

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

Set it in `.env.demo` in **all four** places that must agree:
`POSTGRES_PASSWORD`, `DB_PASSWORD`, and the same value inside `DATABASE_URL`
(`postgresql+psycopg2://inventory_demo:<pw>@db:5432/inventory_demo`). Never reuse
a password from git history.

### 5. Generate the demo account passwords

```bash
python -c "import secrets; print(secrets.token_urlsafe(18))"   # run twice
```

Set `DEMO_ADMIN_PASSWORD` and `DEMO_WH_PASSWORD` in `.env.demo`. These become the
`wc_admin` / `wc_wh` login passwords. Keep them handy for the demo.

### 6. Set the Funnel hostname as the CORS origin

The browser only ever talks to the Next BFF (same-origin), so FastAPI CORS is
never exercised — but the production gate still requires one explicit `https://`
origin. In `.env.demo`:

```
CORS_ORIGINS=https://<host>.<tailnet>.ts.net
```

### 7. Pin the image tags

In `.env.demo`:

```
API_IMAGE=inventory-api:sha-<sha>
FRONTEND_IMAGE=inventory-frontend:sha-<sha>
```

`compose.demo.yml` fails fast if either is unset and never uses `:latest`.

### 8. Build the API image

```bash
docker build -t inventory-api:sha-<sha> .
```

### 9. Build the frontend image

```bash
docker build -t inventory-frontend:sha-<sha> frontend/
```

Multi-stage, `output: "standalone"`, runs as non-root `nextjs`. `API_BASE_URL`
and the cookie settings are **runtime** env (from compose), never build args.

### 10. Start PostgreSQL

```bash
docker compose -f compose.demo.yml up -d db
docker compose -f compose.demo.yml ps        # wait for db "healthy"
```

### 11. Apply migrations (one-shot)

```bash
docker compose -f compose.demo.yml --profile migrate run --rm migrate
```

The `api` service never runs migrations on start — this dedicated profile does.

### 12. Verify the schema head

```bash
docker compose -f compose.demo.yml run --rm --no-deps api \
  python -c "from alembic.config import Config; from alembic.script import ScriptDirectory; \
c=Config('alembic.ini'); print('head:', ScriptDirectory.from_config(c).get_current_head())"
```

Confirm it matches the revision this build expects (the `/ready` check in
step 15 enforces the same thing).

### 13. Start the API

```bash
docker compose -f compose.demo.yml up -d api
```

### 14. Check liveness

```bash
docker compose -f compose.demo.yml exec api \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8081/health').status)"
```

Expect `200`.

### 15. Check readiness

```bash
docker compose -f compose.demo.yml exec api \
  python -c "import urllib.request,json; print(json.load(urllib.request.urlopen('http://127.0.0.1:8081/ready')))"
```

Expect `{'status': 'ready', ...}`. A `migration_mismatch` here means step 11
did not complete.

### 16. Seed the demo data (one-shot)

```bash
docker compose -f compose.demo.yml --profile seed run --rm seed
```

Reads `.env.demo` + `DEMO_API=http://api:8081/api/v1`. Creates the foundation
warehouses/locations, `wc_admin` / `wc_wh`, products and stock in every state
(healthy / low / expired / near-expiry / reserved), and drives Sales, Purchase
Order and Transfer lifecycles through the public API. It refuses to run without
`SEED_CONFIRM=1` and refuses production-like database targets.

The script ends with a **REQUIRED-STATE check**: it reads the data back and, if
any condition the demo depends on is missing (a demo account, each stock state,
each order/PO/transfer lifecycle state, movement + audit rows), it prints
`FAIL:` lines and **exits non-zero** — so `run --rm seed` failing means the
demo data is incomplete, not that it "mostly worked". Expected tail:
`REQUIRED DEMO STATE CHECK: PASS (full)`.

### 17. Start the frontend and nginx

```bash
docker compose -f compose.demo.yml up -d frontend nginx
docker compose -f compose.demo.yml ps        # all "healthy"
```

### 18. Local smoke test

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/          # 200/307
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/login     # 200
```

Open `http://127.0.0.1:8080/login` on the host, log in as `wc_admin`, and click
through Dashboard, Products, Stock, Sales, Picking, Packing, Shipping, Purchase
Orders, Transfers, Reports, Audit. In the browser dev-tools Network tab, confirm
every request is same-origin (`/api/auth/*`, `/api/bff/*`) — never `api:8081` or
`:8081`.

### 19. Confirm Funnel is available

```bash
tailscale status
tailscale funnel status        # shows current Funnel config (empty is fine)
```

If `funnel status` reports Funnel is not permitted, enable it for this node in
the Tailscale admin console and re-run.

### 20. Enable Funnel to the demo nginx

Funnel points at the **loopback nginx port (8080)**, not Next.js directly:

```bash
tailscale funnel --bg 8080
```

This serves `http://127.0.0.1:8080` at `https://<host>.<tailnet>.ts.net` (port
443) in the background. `tailscale funnel status` now lists the mapping.

> Older Tailscale builds use `tailscale funnel 8080 on` / a two-step
> `tailscale serve` + `tailscale funnel on`. Use `tailscale funnel --help` to
> confirm the syntax for your version.

### 21. Verify the external URL

From a network **off** the host's Wi-Fi/LAN (phone on cellular is ideal):

```
https://<host>.<tailnet>.ts.net/login
```

Log in as `wc_admin`. Confirm HTTPS (valid cert, no warning), the login round-trip
works, and the route sweep from step 18 renders. Check a report XLSX download and
an invoice PDF open correctly (they stream through the BFF).

### 22. Stop Funnel when done

```bash
tailscale funnel --https=443 off      # or: tailscale funnel reset
tailscale funnel status               # confirm nothing is served
```

The `*.ts.net` URL stops responding immediately.

### 23. Tear down / reset

```bash
# stop everything, keep data:
docker compose -f compose.demo.yml down

# stop AND wipe the demo database + volumes:
docker compose -f compose.demo.yml down -v

# reset just the data and reseed (containers stay):
docker compose -f compose.demo.yml down -v
docker compose -f compose.demo.yml up -d db
docker compose -f compose.demo.yml --profile migrate run --rm migrate
docker compose -f compose.demo.yml up -d api
docker compose -f compose.demo.yml --profile seed run --rm seed
docker compose -f compose.demo.yml up -d frontend nginx
```

---

## Demo accounts

| Username   | Role      | Password source (`.env.demo`) | Can do                                    |
|------------|-----------|-------------------------------|-------------------------------------------|
| `wc_admin` | admin     | `DEMO_ADMIN_PASSWORD`         | everything, incl. Audit, order confirm/complete, master-data create |
| `wc_wh`    | warehouse | `DEMO_WH_PASSWORD`            | picking/packing/shipping, receiving, transfers, returns; no Audit   |

The auth rate limit is unchanged: 5 failed logins in 5 minutes locks that
account for the window. Type the demo passwords carefully on a phone.

---

## Security posture (demo)

- Only nginx publishes a host port, and only on `127.0.0.1`. PostgreSQL and
  FastAPI have **no** host port — `expose` on the private compose network only.
- Funnel terminates TLS at the Tailscale edge; nginx and everything behind it
  speak plain HTTP on the private network.
- **Client IP is established once, by nginx, and cannot be spoofed.** The nginx
  container is reachable only through Docker's forward of the host's
  loopback-bound `127.0.0.1:8080` (i.e. Funnel), which arrives from the Docker
  bridge gateway — so `set_real_ip_from` trusts the private bridge ranges and
  nothing else (the Tailscale CGNAT `100.64.0.0/10` is deliberately *not*
  trusted, so a tailnet client's own address is taken as the real client, not
  seen through). With `real_ip_recursive on`, nginx walks `X-Forwarded-For`
  right-to-left past trusted hops and stops at Funnel's real-client entry;
  a browser-supplied `X-Forwarded-For` always sits left of that and is never
  selected. nginx writes that vetted address to `X-Real-IP`; the BFF forwards
  **only** `X-Real-IP` on to FastAPI as a single-hop `X-Forwarded-For` (it
  never reads the raw chain). `TRUSTED_PROXY_COUNT` stays `0`; uvicorn keeps
  `--proxy-headers --forwarded-allow-ips "*"` (only the BFF talks to FastAPI on
  the private network).
- nginx has **no** `location /api/v1/` — the FastAPI surface is never reachable
  from the Internet; the browser only sees the Next app.
- `wc_session` is HttpOnly, SameSite=Lax, and `Secure` (`COOKIE_SECURE=1`).
- `/docs` and `/redoc` are off (`DOCS_ENABLED` unset with `ENV=production`).
- `.env.demo` is git-ignored; `.env.demo.example` holds placeholders only.
- nginx `client_max_body_size 20M` stays above the backend `MAX_UPLOAD_BYTES`
  (5 MiB) so the app's own 413 is what a user hits, not nginx's.

---

## Future: VPS + Let's Encrypt (not implemented here)

To run the same stack on a public VPS with its own domain instead of Funnel,
add a TLS front end and skip Tailscale:

- Point `demo.example.com` A/AAAA records at the VPS.
- Add a `listen 443 ssl; http2 on;` server block to a copy of `nginx/demo.conf`,
  with `ssl_certificate` / `ssl_certificate_key` from certbot
  (`certbot certonly --webroot` or the nginx plugin), an `80 → 443` redirect,
  and `Strict-Transport-Security`.
- Publish `443:443` (and `80:80` for the ACME challenge) instead of
  `127.0.0.1:8080:80`.
- Keep `set_real_ip_from` accurate for the new front end, and set
  `CORS_ORIGINS=https://demo.example.com`.
- Everything else (compose services, migrate/seed profiles, the API and
  frontend images) is unchanged.

This variant is documented for reference only; the supported demo path is
Tailscale Funnel above.
