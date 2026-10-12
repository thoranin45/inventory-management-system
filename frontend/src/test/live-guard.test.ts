import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_EXPECTED_SERVICE,
  LiveGuardError,
  createLiveClient,
  expectedConsent,
  liveEnabled,
  resolveLiveConfig,
  type FetchLike,
  type LiveConfig,
  type LiveEnv,
} from "./live-guard";

/**
 * Regression tests for the fail-closed live contract guard (R0a). Everything
 * here runs against in-memory doubles: the global fetch is replaced with a
 * tripwire, so a test that tried to reach a real backend would fail.
 */

const RUN = "r0aguardtest0001";
const ORIGIN = "http://127.0.0.1:18081";
const WH_PASS = "w".repeat(40);
const ADMIN_PASS = "a".repeat(40);

function validEnv(overrides: Record<string, string | undefined> = {}): LiveEnv {
  return {
    LIVE_BACKEND: "1",
    LIVE_API_BASE_URL: ORIGIN,
    LIVE_RUN_ID: RUN,
    LIVE_MUTATION_CONSENT: expectedConsent(ORIGIN, RUN),
    LIVE_USER: `e2e_wh_${RUN}`,
    LIVE_PASS: WH_PASS,
    LIVE_ADMIN_USER: `e2e_admin_${RUN}`,
    LIVE_ADMIN_PASS: ADMIN_PASS,
    ...overrides,
  };
}

/** The refusal message for an environment the guard must reject. */
function refusal(env: LiveEnv): string {
  try {
    resolveLiveConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(LiveGuardError);
    return (error as Error).message;
  }
  throw new Error("expected resolveLiveConfig to refuse this environment");
}

const tripwire = vi.fn(() => Promise.reject(new Error("network access is disabled in guard tests")));

beforeEach(() => {
  tripwire.mockClear();
  vi.stubGlobal("fetch", tripwire);
});

afterEach(() => {
  expect(tripwire).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// In-memory backend double
// ---------------------------------------------------------------------------

interface Reply {
  status: number;
  body?: unknown;
  location?: string;
}

interface Call {
  method: string;
  path: string;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

interface BackendOptions {
  health?: Reply;
  ready?: Reply;
  login?: (username: string) => Reply | undefined;
  me?: (username: string) => Reply | undefined;
  other?: (method: string, path: string) => Reply | undefined;
}

function respond({ status, body, location }: Reply): Response {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "location" ? (location ?? null) : null) },
    json: async () => {
      if (body === undefined) throw new SyntaxError("no JSON body");
      return body;
    },
  } as unknown as Response;
}

const HEALTH_OK: Reply = {
  status: 200,
  body: { success: true, message: "Application is healthy", data: { status: "ok", service: LIVE_EXPECTED_SERVICE, version: "test" } },
};
const READY_OK: Reply = { status: 200, body: { status: "ready", database: "ok" } };

const ATTESTATION = [
  "GET /health",
  "GET /ready",
  "POST /api/v1/auth/token",
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/token",
  "GET /api/v1/auth/me",
];

function backend(options: BackendOptions = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const { pathname, search } = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, path: pathname + search, body: init.body, signal: init.signal });
    if (pathname === "/health") return respond(options.health ?? HEALTH_OK);
    if (pathname === "/ready") return respond(options.ready ?? READY_OK);
    if (pathname === "/api/v1/auth/token") {
      const username = new URLSearchParams(String(init.body)).get("username") ?? "";
      return respond(
        options.login?.(username) ?? { status: 200, body: { access_token: `token:${username}`, token_type: "bearer" } },
      );
    }
    if (pathname === "/api/v1/auth/me") {
      const authorization = (init.headers as Record<string, string> | undefined)?.authorization ?? "";
      const username = authorization.replace(/^Bearer token:/, "");
      const role = username.startsWith("e2e_admin_") ? "admin" : "warehouse";
      return respond(options.me?.(username) ?? { status: 200, body: { id: 1, username, role, is_active: true } });
    }
    return respond(options.other?.(method, pathname + search) ?? { status: 200, body: { ok: true } });
  });
  return { fetchImpl, calls, paths: () => calls.map((call) => `${call.method} ${call.path}`) };
}

function clientFor(api: ReturnType<typeof backend>, timeoutMs?: number) {
  return createLiveClient(resolveLiveConfig(validEnv()), { fetchImpl: api.fetchImpl, timeoutMs });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe("resolveLiveConfig: the environment must describe a disposable target", () => {
  it("is off unless LIVE_BACKEND is exactly 1", () => {
    expect(liveEnabled({})).toBe(false);
    for (const value of ["", "0", "true", "yes", " 1"]) expect(liveEnabled({ LIVE_BACKEND: value })).toBe(false);
    expect(liveEnabled({ LIVE_BACKEND: "1" })).toBe(true);
  });

  it("accepts a complete, valid environment and freezes the result", () => {
    const config = resolveLiveConfig(validEnv());
    expect(config.origin).toBe(ORIGIN);
    expect(config.runId).toBe(RUN);
    expect(config.warehouse.username).toBe(`e2e_wh_${RUN}`);
    expect(config.admin.username).toBe(`e2e_admin_${RUN}`);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.warehouse)).toBe(true);
    expect(Object.isFrozen(config.admin)).toBe(true);
  });

  it("refuses when LIVE_BACKEND is not 1", () => {
    expect(refusal(validEnv({ LIVE_BACKEND: undefined }))).toMatch(/LIVE_BACKEND must be 1/);
  });

  it("lists every missing variable in one refusal", () => {
    const message = refusal({ LIVE_BACKEND: "1" });
    for (const name of [
      "LIVE_API_BASE_URL",
      "LIVE_RUN_ID",
      "LIVE_MUTATION_CONSENT",
      "LIVE_USER",
      "LIVE_PASS",
      "LIVE_ADMIN_USER",
      "LIVE_ADMIN_PASS",
    ]) {
      expect(message).toContain(name);
    }
  });

  it("never falls back to API_BASE_URL", () => {
    expect(refusal(validEnv({ LIVE_API_BASE_URL: undefined, API_BASE_URL: ORIGIN }))).toMatch(
      /LIVE_API_BASE_URL is required/,
    );
  });

  it.each([
    ["not a url", /not a valid URL/],
    ["https://127.0.0.1:18081", /must use http:/],
    ["ftp://127.0.0.1:18081", /must use http:/],
    ["http://user:hunter2-secret@127.0.0.1:18081", /must not contain credentials/],
    ["http://127.0.0.1:18081/api", /bare origin/],
    ["http://127.0.0.1:18081/?target=x", /bare origin/],
    ["http://127.0.0.1:18081/#x", /bare origin/],
  ])("refuses the malformed or unsafe URL %s", (url, pattern) => {
    const message = refusal(validEnv({ LIVE_API_BASE_URL: url }));
    expect(message).toMatch(pattern);
    expect(message).not.toContain("hunter2-secret");
  });

  it.each(["inventory-api", "192.168.1.10", "example.com", "localhost.example.com", "127.0.0.1.nip.io", "0.0.0.0", "127.0.0.2"])(
    "refuses the non-loopback host %s",
    (host) => {
      expect(refusal(validEnv({ LIVE_API_BASE_URL: `http://${host}:18081` }))).toMatch(/host must be one of/);
    },
  );

  it.each([
    ["no port", "http://127.0.0.1"],
    ["the dev API port 8081", "http://127.0.0.1:8081"],
    ["the demo port 8080", "http://127.0.0.1:8080"],
    ["port 80", "http://127.0.0.1:80"],
    ["the dev Postgres port 5433", "http://127.0.0.1:5433"],
    ["the Next dev port 3000", "http://127.0.0.1:3000"],
    ["the E2E web port 18080", "http://127.0.0.1:18080"],
  ])("refuses %s", (_label, url) => {
    expect(refusal(validEnv({ LIVE_API_BASE_URL: url }))).toMatch(/disposable E2E port/);
  });

  it.each(["127.0.0.1", "localhost", "[::1]"])("accepts the loopback host %s on the E2E port", (host) => {
    const origin = `http://${host}:18081`;
    const config = resolveLiveConfig(
      validEnv({ LIVE_API_BASE_URL: origin, LIVE_MUTATION_CONSENT: expectedConsent(origin, RUN) }),
    );
    expect(config.origin).toBe(origin);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", "abc123"],
    ["uppercase", "R0AGUARDTEST0001"],
    ["punctuated", "r0a-guard-test-01"],
    ["too long", "a".repeat(33)],
  ])("refuses a %s LIVE_RUN_ID", (_label, runId) => {
    expect(refusal(validEnv({ LIVE_RUN_ID: runId }))).toMatch(/LIVE_RUN_ID must be/);
  });

  it("refuses a missing mutation consent", () => {
    expect(refusal(validEnv({ LIVE_MUTATION_CONSENT: undefined }))).toMatch(/LIVE_MUTATION_CONSENT is required/);
  });

  it.each([
    ["another origin", expectedConsent("http://localhost:18081", RUN)],
    ["another run", expectedConsent(ORIGIN, "otherrun00000001")],
    ["a bare yes", "yes"],
  ])("refuses consent bound to %s", (_label, consent) => {
    expect(refusal(validEnv({ LIVE_MUTATION_CONSENT: consent }))).toMatch(
      /LIVE_MUTATION_CONSENT does not match this origin and LIVE_RUN_ID/,
    );
  });

  it.each([
    ["LIVE_USER", "wc_wh"],
    ["LIVE_USER", "e2e_wh_otherrun00000001"],
    ["LIVE_USER", `e2e_admin_${RUN}`],
    ["LIVE_ADMIN_USER", "wc_admin"],
    ["LIVE_ADMIN_USER", `e2e_wh_${RUN}`],
  ])("refuses %s=%s because accounts must be the per-run ones", (name, value) => {
    expect(refusal(validEnv({ [name]: value }))).toMatch(new RegExp(`${name} must be the per-run`));
  });

  it.each(["LIVE_PASS", "LIVE_ADMIN_PASS"])("refuses a missing or weak %s without echoing it", (name) => {
    expect(refusal(validEnv({ [name]: undefined }))).toMatch(new RegExp(`${name} is required`));
    const weak = "Weak-But-Not-Empty-21";
    const message = refusal(validEnv({ [name]: weak }));
    expect(message).toMatch(new RegExp(`${name} must be at least 32 characters`));
    expect(message).not.toContain(weak);
  });

  it("never echoes credentials or account names, even when everything else is wrong", () => {
    const message = refusal(
      validEnv({
        LIVE_API_BASE_URL: "http://user:hunter2-secret@example.com:9999/x",
        LIVE_USER: "someone-else",
        LIVE_ADMIN_USER: "another-person",
      }),
    );
    for (const value of [WH_PASS, ADMIN_PASS, "hunter2-secret", "someone-else", "another-person"]) {
      expect(message).not.toContain(value);
    }
  });
});

// ---------------------------------------------------------------------------
// Client: attestation, timeouts, redirects, mutation authorisation
// ---------------------------------------------------------------------------

describe("createLiveClient: nothing is sent before attestation passes", () => {
  it("refuses a hand-built config without valid mutation consent, before any network access", () => {
    const api = backend();
    const tampered: LiveConfig = { ...resolveLiveConfig(validEnv()), consent: "mutate:anything" };
    expect(() => createLiveClient(tampered, { fetchImpl: api.fetchImpl })).toThrow(/LIVE_MUTATION_CONSENT/);
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a hand-built config aimed at a non-loopback origin", () => {
    const api = backend();
    const origin = "http://192.168.1.10:18081";
    const tampered: LiveConfig = { ...resolveLiveConfig(validEnv()), origin, consent: expectedConsent(origin, RUN) };
    expect(() => createLiveClient(tampered, { fetchImpl: api.fetchImpl })).toThrow(/host must be one of/);
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });

  it("attests health, readiness and both per-run accounts before the first request", async () => {
    const api = backend();
    const res = await clientFor(api).request("/api/v1/sales-orders/", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(api.paths()).toEqual([...ATTESTATION, "POST /api/v1/sales-orders/"]);
  });

  it("logs in with exactly the per-run accounts it was given", async () => {
    const api = backend();
    await clientFor(api).attest();
    const usernames = api.calls
      .filter((call) => call.path === "/api/v1/auth/token")
      .map((call) => new URLSearchParams(String(call.body)).get("username"));
    expect(usernames).toEqual([`e2e_wh_${RUN}`, `e2e_admin_${RUN}`]);
  });

  it.each<[string, BackendOptions, string[]]>([
    ["/health fails", { health: { status: 500 } }, ["GET /health"]],
    [
      "/health belongs to another service",
      { health: { status: 200, body: { data: { status: "ok", service: "Something Else" } } } },
      ["GET /health"],
    ],
    [
      "/ready reports a migration mismatch",
      { ready: { status: 503, body: { status: "unavailable", reason: "migration_mismatch" } } },
      ["GET /health", "GET /ready"],
    ],
    [
      "the per-run warehouse login fails",
      { login: (username) => (username.startsWith("e2e_wh_") ? { status: 401, body: { detail: "nope" } } : undefined) },
      ATTESTATION.slice(0, 3),
    ],
    ["the login returns no token", { login: () => ({ status: 200, body: { token_type: "bearer" } }) }, ATTESTATION.slice(0, 3)],
    [
      "the warehouse account has the admin role",
      {
        me: (username) =>
          username.startsWith("e2e_wh_") ? { status: 200, body: { username, role: "admin", is_active: true } } : undefined,
      },
      ATTESTATION.slice(0, 4),
    ],
    [
      "the admin account is inactive",
      {
        me: (username) =>
          username.startsWith("e2e_admin_") ? { status: 200, body: { username, role: "admin", is_active: false } } : undefined,
      },
      ATTESTATION,
    ],
  ])("sends no mutating request when %s", async (_label, options, expected) => {
    const api = backend(options);
    await expect(clientFor(api).request("/api/v1/sales-orders/", { method: "POST", body: "{}" })).rejects.toThrow(
      /Attestation failed/,
    );
    expect(api.paths()).toEqual(expected);
  });

  it("runs attestation once for concurrent requests and keeps a failure final", async () => {
    const ok = backend();
    const client = clientFor(ok);
    await Promise.all([client.request("/api/v1/products"), client.request("/api/v1/products")]);
    expect(ok.paths().filter((path) => path === "GET /health")).toHaveLength(1);

    const down = backend({ health: { status: 503 } });
    const failing = clientFor(down);
    await expect(failing.request("/api/v1/products")).rejects.toThrow(/Attestation failed/);
    await expect(failing.request("/api/v1/products")).rejects.toThrow(/Attestation failed/);
    expect(down.paths()).toEqual(["GET /health"]);
  });

  it("times out a request that never answers and aborts it", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = vi.fn<FetchLike>((_url, init) => {
      signals.push(init.signal);
      return new Promise<Response>(() => {});
    });
    const client = createLiveClient(resolveLiveConfig(validEnv()), { fetchImpl, timeoutMs: 20 });
    await expect(client.request("/api/v1/products")).rejects.toThrow(/timed out after 20 ms/);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("clears the request timer once response headers arrive (body reads are not covered by it)", async () => {
    const api = backend();
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = vi.fn<FetchLike>((url, init) => {
      signals.push(init.signal);
      return api.fetchImpl(url, init);
    });
    const client = createLiveClient(resolveLiveConfig(validEnv()), { fetchImpl, timeoutMs: 20 });
    expect((await client.request("/api/v1/products")).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(signals).toHaveLength(ATTESTATION.length + 1);
    expect(signals.every((signal) => signal?.aborted === false)).toBe(true);
  });

  it("sends a canonical GET once and returns its response", async () => {
    const api = backend();
    const res = await clientFor(api).request("/api/v1/sales-orders/?page=1&page_size=50");
    expect(res.status).toBe(200);
    expect(api.paths().slice(ATTESTATION.length)).toEqual(["GET /api/v1/sales-orders/?page=1&page_size=50"]);
  });

  const REDIRECT_CASES: Array<[number, string]> = ["GET", "POST", "PUT", "PATCH", "DELETE"].flatMap((method) =>
    [301, 302, 303, 307, 308].map((status): [number, string] => [status, method]),
  );

  it.each(REDIRECT_CASES)("refuses an HTTP %i response to %s without following or replaying it", async (status, method) => {
    const api = backend({
      other: (_method, path) => (path === "/api/v1/sales-orders" ? { status, location: "/api/v1/sales-orders/" } : undefined),
    });
    const init = method === "GET" ? {} : { method, body: '{"a":1}' };
    await expect(clientFor(api).request("/api/v1/sales-orders", init)).rejects.toThrow(
      new RegExp(`Refused an HTTP ${status} redirect for ${method} /api/v1/sales-orders`),
    );
    // Sent exactly once: neither the Location nor a repeat of the original was requested.
    expect(api.paths().slice(ATTESTATION.length)).toEqual([`${method} /api/v1/sales-orders`]);
  });

  it.each([300, 304, 307])("refuses an HTTP %i response that has no Location header", async (status) => {
    const api = backend({ other: () => ({ status }) });
    await expect(clientFor(api).request("/api/v1/products", { method: "POST", body: "{}" })).rejects.toThrow(
      new RegExp(`Refused an HTTP ${status} redirect`),
    );
    expect(api.paths().slice(ATTESTATION.length)).toEqual(["POST /api/v1/products"]);
  });

  it("refuses a redirect to another origin without contacting it", async () => {
    const api = backend({ other: () => ({ status: 307, location: "http://evil.example:18081/steal" }) });
    await expect(clientFor(api).request("/api/v1/products")).rejects.toThrow(/Refused an HTTP 307 redirect/);
    expect(api.paths().slice(ATTESTATION.length)).toEqual(["GET /api/v1/products"]);
    expect(api.paths().some((path) => path.includes("/steal"))).toBe(false);
  });

  it("fails attestation, without following, when /health redirects", async () => {
    const api = backend({ health: { status: 307, location: "/health/" } });
    const client = clientFor(api);
    await expect(client.request("/api/v1/products")).rejects.toThrow(/Refused an HTTP 307 redirect for GET \/health/);
    await expect(client.request("/api/v1/products")).rejects.toThrow(/Refused an HTTP 307 redirect for GET \/health/);
    expect(api.paths()).toEqual(["GET /health"]);
  });

  it("never re-sends login credentials when the token endpoint redirects", async () => {
    const api = backend({ login: () => ({ status: 307, location: "/api/v1/auth/token/" }) });
    await expect(clientFor(api).request("/api/v1/products")).rejects.toThrow(
      /Refused an HTTP 307 redirect for POST \/api\/v1\/auth\/token/,
    );
    expect(api.paths()).toEqual(["GET /health", "GET /ready", "POST /api/v1/auth/token"]);
  });

  it("keeps attestation and origin checks in force after refusing a redirect", async () => {
    const api = backend({
      other: (_method, path) => (path === "/api/v1/old" ? { status: 308, location: "/api/v1/new" } : undefined),
    });
    const client = clientFor(api);
    await expect(client.request("/api/v1/old", { method: "POST", body: "{}" })).rejects.toThrow(
      /Refused an HTTP 308 redirect/,
    );
    await expect(client.request("//evil.example/x")).rejects.toThrow(LiveGuardError);
    await expect(client.request("http://127.0.0.1:18081/api/v1/new")).rejects.toThrow(LiveGuardError);
    expect((await client.request("/api/v1/products")).status).toBe(200);
    expect(api.paths()).toEqual([...ATTESTATION, "POST /api/v1/old", "GET /api/v1/products"]);
  });

  it.each(["http://127.0.0.1:18081/api/v1/products", "//evil.example/x", "/\\evil.example/x", "api/v1/products"])(
    "refuses the non-relative path %s before contacting anything",
    async (path) => {
      const api = backend();
      await expect(clientFor(api).request(path)).rejects.toThrow(LiveGuardError);
      expect(api.fetchImpl).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// Static checks: the suite only runs deliberately, and only through the guard
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(here, "..", "..");
const repoDir = join(frontendDir, "..");
const read = (path: string) => readFileSync(path, "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("the live suite runs only deliberately, and only through the guard", () => {
  const suite = read(join(frontendDir, "src", "lib", "api", "schemas", "live-contract.test.ts"));

  it("reaches the backend only through the guard's client", () => {
    expect(suite).not.toMatch(/\bfetch\s*\(/);
    expect(suite).toMatch(/LIVE \? createLiveClient\(resolveLiveConfig\(process\.env\)\) : null/);
    expect(suite).not.toMatch(/API_BASE_URL/);
    expect(suite).not.toMatch(
      /process\.env\.LIVE_(BACKEND|API_BASE_URL|RUN_ID|MUTATION_CONSENT|USER|PASS|ADMIN_USER|ADMIN_PASS)\b/,
    );
  });

  it("calls the canonical trailing-slash routes, because redirects are refused", () => {
    expect(suite).not.toMatch(/["'`]\/api\/v1\/(sales-orders|audit-logs)(\?|["'`])/);
  });

  it("keeps every block opt-in", () => {
    const blocks = suite.match(/\bdescribe\s*[.(]/g) ?? [];
    const gated = suite.match(/\bdescribe\.skipIf\(!LIVE\)\(/g) ?? [];
    expect(gated.length).toBeGreaterThan(0);
    expect(blocks).toHaveLength(gated.length);
  });

  it("is the only test that opts into live mode", () => {
    const optIns = walk(join(frontendDir, "src"))
      .filter((path) => /\.(ts|tsx|mts)$/.test(path) && read(path).includes("LIVE_BACKEND"))
      .map((path) => relative(frontendDir, path).replaceAll("\\", "/"))
      .sort();
    expect(optIns).toEqual([
      "src/lib/api/schemas/live-contract.test.ts",
      "src/test/live-guard.test.ts",
      "src/test/live-guard.ts",
    ]);
  });

  it("is never enabled by the default config, the npm scripts or CI", () => {
    expect(read(join(frontendDir, "vitest.config.mts"))).not.toMatch(/LIVE_/);

    const { scripts } = JSON.parse(read(join(frontendDir, "package.json"))) as { scripts: Record<string, string> };
    expect(scripts.test).toBe("vitest run");
    expect(scripts["test:live"]).toBe("vitest run --config vitest.live.config.mts");
    for (const [name, command] of Object.entries(scripts)) {
      if (name !== "test:live") expect(command).not.toMatch(/LIVE_|live-contract|vitest\.live/);
    }

    const liveConfig = read(join(frontendDir, "vitest.live.config.mts"));
    expect(liveConfig).toMatch(/include: \["src\/lib\/api\/schemas\/live-contract\.test\.ts"\]/);
    expect(liveConfig).toMatch(/retry: 0/);

    const workflow = read(join(repoDir, ".github", "workflows", "frontend.yml"));
    expect(workflow).toMatch(/LIVE_BACKEND: ""/);
    expect(workflow).not.toMatch(/test:live|vitest\.live|secrets\.|pull_request_target/);
    expect(workflow).not.toMatch(/^\s*paths(-ignore)?:/m);
    expect(workflow).not.toMatch(/^\s+if:/m);
  });

  it("contains none of the default passwords removed in R0a, and no LIVE_* fallbacks", () => {
    // SHA-256 digests of the two fallback passwords that used to be committed.
    // The values themselves stay out of the tree.
    const removed = new Set([
      "5f2f45cffe4b5cc0698911b0df986c4e423abe51722cf5249847cae0962ce50a",
      "3eb3fe66b31e3b4d10fa70b5cad49c7112294af6ae4e476a1c405155d45aa121",
    ]);
    const files = [
      ...walk(join(frontendDir, "src")),
      ...walk(join(frontendDir, "docs")),
      join(frontendDir, "README.md"),
      join(frontendDir, "package.json"),
      join(frontendDir, "vitest.config.mts"),
      join(frontendDir, "vitest.live.config.mts"),
      join(repoDir, "AGENTS.md"),
      join(repoDir, "docs", "release-checklist.md"),
      join(repoDir, ".github", "workflows", "frontend.yml"),
    ].filter((path) => /\.(ts|tsx|mts|md|json|ya?ml)$/.test(path));
    const withRemovedPassword = files.filter((path) =>
      read(path)
        .split(/[\s"'`|,;:()<>{}[\]=\\]+/)
        .map((token) => token.replace(/\.+$/, ""))
        .some(
          (token) =>
            token.length >= 8 && token.length <= 24 && removed.has(createHash("sha256").update(token).digest("hex")),
        ),
    );
    expect(withRemovedPassword.map((path) => relative(repoDir, path))).toEqual([]);

    const withFallback = files.filter((path) => /process\.env\.LIVE_[A-Z_]+\s*\?\?/.test(read(path)));
    expect(withFallback.map((path) => relative(repoDir, path))).toEqual([]);
  });
});
