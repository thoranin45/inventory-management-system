/**
 * Fail-closed guard for the opt-in live contract suite
 * (src/lib/api/schemas/live-contract.test.ts).
 *
 * That suite sends real requests, many of them mutating, to a FastAPI backend.
 * It may only ever reach a disposable instance seeded for a single run, so:
 *
 *  - `resolveLiveConfig` accepts the environment only when every LIVE_* value
 *    describes that instance: a loopback origin on the E2E port, a per-run id,
 *    consent bound to both, and per-run warehouse and admin accounts. It lists
 *    every problem at once and never echoes a credential.
 *  - `createLiveClient(...).request` is the suite's only transport. Before the
 *    first request it attests the target once (health, readiness, both per-run
 *    accounts) and a failed attestation is final. Every request is sent at
 *    most once: it is never retried, and any 3xx response is refused rather
 *    than followed, so the suite must call canonical URLs.
 *  - A 15-second timer covers each fetch until its response headers arrive.
 *    Reading the response body is not covered by that timer; the Vitest test
 *    and hook timeouts bound it.
 *
 * Attestation lowers the risk of reaching the wrong backend. It does not prove
 * that the backend uses an isolated database; that has to come from the
 * disposable environment itself (R0b).
 */

export const LIVE_ALLOWED_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];
/** The disposable E2E API port. The dev API (8081) and the demo (8080) are deliberately absent. */
export const LIVE_ALLOWED_PORTS: readonly string[] = ["18081"];
export const LIVE_EXPECTED_SERVICE = "Inventory Management API";
export const LIVE_MIN_PASSWORD_LENGTH = 32;
/** Time each fetch has to receive response headers. Reading the body is not covered. */
export const LIVE_REQUEST_TIMEOUT_MS = 15_000;

const RUN_ID_PATTERN = /^[a-z0-9]{12,32}$/;

export class LiveGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveGuardError";
  }
}

export type LiveRole = "warehouse" | "admin";

export interface LiveAccount {
  readonly username: string;
  readonly password: string;
}

export interface LiveConfig {
  readonly origin: string;
  readonly runId: string;
  readonly consent: string;
  readonly warehouse: LiveAccount;
  readonly admin: LiveAccount;
}

export type LiveEnv = Readonly<Record<string, string | undefined>>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LiveClient {
  readonly config: LiveConfig;
  /** Read-only attestation of the target. Runs once; its result is final. */
  attest(): Promise<void>;
  /** The live suite's only transport. Waits for attestation before sending. */
  request(path: string, init?: RequestInit): Promise<Response>;
}

export interface LiveClientOptions {
  /** Test double for `fetch`; defaults to the global one. */
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

/** The suite is opt-in: only LIVE_BACKEND=1 enables it. */
export function liveEnabled(env: LiveEnv): boolean {
  return env.LIVE_BACKEND === "1";
}

export function expectedConsent(origin: string, runId: string): string {
  return `mutate:${origin}:${runId}`;
}

export function perRunUsername(role: LiveRole, runId: string): string {
  return `e2e_${role === "warehouse" ? "wh" : "admin"}_${runId}`;
}

function checkOrigin(raw: string | undefined, problems: string[]): string | null {
  if (!raw) {
    problems.push("LIVE_API_BASE_URL is required (API_BASE_URL is never used as a fallback)");
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push("LIVE_API_BASE_URL is not a valid URL");
    return null;
  }
  const before = problems.length;
  if (url.protocol !== "http:") problems.push("LIVE_API_BASE_URL must use http:");
  if (url.username || url.password) problems.push("LIVE_API_BASE_URL must not contain credentials");
  if (!LIVE_ALLOWED_HOSTS.includes(url.hostname)) {
    problems.push(`LIVE_API_BASE_URL host must be one of ${LIVE_ALLOWED_HOSTS.join(", ")}`);
  }
  if (!LIVE_ALLOWED_PORTS.includes(url.port)) {
    problems.push(
      `LIVE_API_BASE_URL must name the disposable E2E port explicitly (${LIVE_ALLOWED_PORTS.join(", ")})`,
    );
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    problems.push("LIVE_API_BASE_URL must be a bare origin (no path, query or fragment)");
  }
  return problems.length === before ? url.origin : null;
}

function checkAccount(
  env: LiveEnv,
  role: LiveRole,
  runId: string | null,
  problems: string[],
): LiveAccount | null {
  const userVar = role === "warehouse" ? "LIVE_USER" : "LIVE_ADMIN_USER";
  const passVar = role === "warehouse" ? "LIVE_PASS" : "LIVE_ADMIN_PASS";
  const username = env[userVar];
  const password = env[passVar];
  const before = problems.length;
  if (!username) {
    problems.push(`${userVar} is required`);
  } else if (runId && username !== perRunUsername(role, runId)) {
    problems.push(`${userVar} must be the per-run ${role} account ${perRunUsername(role, "<LIVE_RUN_ID>")}`);
  }
  if (!password) {
    problems.push(`${passVar} is required`);
  } else if (password.length < LIVE_MIN_PASSWORD_LENGTH) {
    problems.push(`${passVar} must be at least ${LIVE_MIN_PASSWORD_LENGTH} characters (generate one per run)`);
  }
  if (problems.length !== before || !username || !password) return null;
  return Object.freeze({ username, password });
}

/**
 * Validates the whole live environment. Throws a LiveGuardError listing every
 * problem (variable names only, never values) unless all checks pass.
 */
export function resolveLiveConfig(env: LiveEnv): LiveConfig {
  const problems: string[] = [];
  if (!liveEnabled(env)) problems.push("LIVE_BACKEND must be 1");
  const origin = checkOrigin(env.LIVE_API_BASE_URL, problems);
  const rawRunId = env.LIVE_RUN_ID;
  const runId = rawRunId !== undefined && RUN_ID_PATTERN.test(rawRunId) ? rawRunId : null;
  if (!runId) problems.push("LIVE_RUN_ID must be 12–32 lowercase letters or digits, generated for this run");
  const warehouse = checkAccount(env, "warehouse", runId, problems);
  const admin = checkAccount(env, "admin", runId, problems);
  const consent = env.LIVE_MUTATION_CONSENT;
  if (!consent) {
    problems.push("LIVE_MUTATION_CONSENT is required (mutate:<origin>:<LIVE_RUN_ID>)");
  } else if (origin && runId && consent !== expectedConsent(origin, runId)) {
    problems.push("LIVE_MUTATION_CONSENT does not match this origin and LIVE_RUN_ID");
  }
  if (problems.length > 0 || !origin || !runId || !warehouse || !admin || !consent) {
    throw new LiveGuardError(`Live contract suite refused to start:\n  - ${problems.join("\n  - ")}`);
  }
  return Object.freeze({ origin, runId, consent, warehouse, admin });
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function createLiveClient(config: LiveConfig, options: LiveClientOptions = {}): LiveClient {
  // A hand-built or altered config gets the same scrutiny as the environment.
  resolveLiveConfig({
    LIVE_BACKEND: "1",
    LIVE_API_BASE_URL: config.origin,
    LIVE_RUN_ID: config.runId,
    LIVE_MUTATION_CONSENT: config.consent,
    LIVE_USER: config.warehouse.username,
    LIVE_PASS: config.warehouse.password,
    LIVE_ADMIN_USER: config.admin.username,
    LIVE_ADMIN_PASS: config.admin.password,
  });
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? LIVE_REQUEST_TIMEOUT_MS;
  let attestation: Promise<void> | null = null;

  function target(path: string): URL {
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new LiveGuardError("Live requests take an origin-relative path starting with a single /");
    }
    const url = new URL(path, config.origin);
    if (url.origin !== config.origin) throw new LiveGuardError("Live request path resolves outside the live target");
    return url;
  }

  async function sendOnce(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new LiveGuardError(
            `Live request timed out after ${timeoutMs} ms waiting for response headers: ${init.method ?? "GET"} ${url.pathname}`,
          ),
        );
      }, timeoutMs);
    });
    // The timer stops when fetch resolves, i.e. once response headers have arrived.
    try {
      return await Promise.race([
        fetchImpl(url.href, { ...init, redirect: "manual", signal: controller.signal }),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const url = target(path);
    const method = (init.method ?? "GET").toUpperCase();
    const res = await sendOnce(url, { ...init, method });
    // The request has been sent exactly once. A redirect is never followed or
    // replayed: any 3xx, with or without a Location header, fails the request.
    if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") {
      throw new LiveGuardError(
        `Refused an HTTP ${res.status} redirect for ${method} ${url.pathname}; call the canonical URL instead`,
      );
    }
    return res;
  }

  async function attestAccount(account: LiveAccount, role: LiveRole): Promise<void> {
    const login = await send("/api/v1/auth/token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: account.username,
        password: account.password,
        grant_type: "password",
      }).toString(),
    });
    const accessToken = field(await readJson(login), "access_token");
    if (login.status !== 200 || typeof accessToken !== "string" || accessToken === "") {
      throw new LiveGuardError(`Attestation failed: the per-run ${role} account could not log in (HTTP ${login.status})`);
    }
    const me = await send("/api/v1/auth/me", {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    });
    const body = await readJson(me);
    const user = field(body, "data") ?? body;
    const userRole = field(user, "role");
    if (
      me.status !== 200 ||
      field(user, "username") !== account.username ||
      typeof userRole !== "string" ||
      userRole.toLowerCase() !== role ||
      field(user, "is_active") !== true
    ) {
      throw new LiveGuardError(`Attestation failed: the per-run ${role} account is not an active ${role} user (HTTP ${me.status})`);
    }
  }

  async function runAttestation(): Promise<void> {
    const health = await send("/health", { headers: { accept: "application/json" } });
    const healthData = field(await readJson(health), "data");
    if (
      health.status !== 200 ||
      field(healthData, "status") !== "ok" ||
      field(healthData, "service") !== LIVE_EXPECTED_SERVICE
    ) {
      throw new LiveGuardError(`Attestation failed: GET /health did not identify the inventory API (HTTP ${health.status})`);
    }
    const ready = await send("/ready", { headers: { accept: "application/json" } });
    if (ready.status !== 200 || field(await readJson(ready), "status") !== "ready") {
      throw new LiveGuardError(`Attestation failed: GET /ready did not report ready (HTTP ${ready.status})`);
    }
    await attestAccount(config.warehouse, "warehouse");
    await attestAccount(config.admin, "admin");
  }

  const client: LiveClient = {
    config,
    attest() {
      if (!attestation) attestation = runAttestation();
      return attestation;
    },
    async request(path, init = {}) {
      target(path); // reject an unsafe path before any network activity
      await client.attest();
      return send(path, init);
    },
  };
  return client;
}
