import "server-only";

import { cookies, headers as nextHeaders } from "next/headers";
import { z } from "zod";

import { API_V1, serverConfig } from "@/lib/config";
import { ApiError } from "./errors";

type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * Proxy headers this server layer passes on to FastAPI so the backend's
 * rate limiter and request logger see the REAL client, not the Next/BFF
 * container.
 *
 * We trust ONLY `X-Real-IP`. The reverse proxy in front of Next (nginx
 * `demo.conf`) is the single component allowed to establish the client
 * address: its `realip` module resolves the true client from the trusted
 * proxy hop and writes it into `X-Real-IP` (`$remote_addr`), overwriting
 * anything the browser sent. We deliberately do NOT read the raw
 * `X-Forwarded-For` chain here — its left-most entries are attacker
 * controlled — we only re-emit the one vetted value as a single-hop
 * `X-Forwarded-For` for uvicorn `--proxy-headers`.
 *
 * Behind no proxy (local `next dev`, or a misconfigured front end that omits
 * `X-Real-IP`) nothing is forwarded and behaviour is unchanged — FastAPI
 * then uses the socket peer. This is transport plumbing only; no auth or
 * business semantics change.
 */
async function forwardedClientHeaders(): Promise<Record<string, string>> {
  let h: Awaited<ReturnType<typeof nextHeaders>>;
  try {
    h = await nextHeaders();
  } catch {
    return {}; // not in a request scope
  }
  const out: Record<string, string> = {};
  const clientIp = (h.get("x-real-ip") || "").trim();
  if (clientIp && !clientIp.includes(",")) out["x-forwarded-for"] = clientIp;
  const proto = h.get("x-forwarded-proto");
  if (proto) out["x-forwarded-proto"] = proto.split(",")[0].trim();
  return out;
}

interface ServerRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  /** JSON body */
  json?: unknown;
  /** raw body (e.g. URLSearchParams for OAuth2 token) + its content-type */
  body?: BodyInit;
  contentType?: string;
  /** attach the session bearer token from the HttpOnly cookie (default true) */
  auth?: boolean;
  /** override / add headers */
  headers?: Record<string, string>;
  /** Next fetch cache hint — dashboard data is always fresh */
  cache?: RequestCache;
  signal?: AbortSignal;
}

export async function getSessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(serverConfig.sessionCookieName)?.value || undefined;
}

function buildUrl(path: string, query?: Query): string {
  const base = path.startsWith("/api/") ? serverConfig.apiBaseUrl : serverConfig.apiBaseUrl + API_V1;
  const url = new URL(base + (path.startsWith("/") ? path : `/${path}`));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Low-level FastAPI call from the server (Route Handlers, Server Components).
 * Returns the parsed Response — callers validate the body with `requestJson`.
 */
export async function rawRequest(path: string, opts: ServerRequestOptions = {}): Promise<Response> {
  const { method = "GET", query, json, body, contentType, auth = true, headers = {}, cache = "no-store", signal } = opts;

  const finalHeaders: Record<string, string> = { accept: "application/json", ...headers };
  let finalBody: BodyInit | undefined;

  if (json !== undefined) {
    finalHeaders["content-type"] = "application/json";
    finalBody = JSON.stringify(json);
  } else if (body !== undefined) {
    if (contentType) finalHeaders["content-type"] = contentType;
    finalBody = body;
  }

  if (auth) {
    const token = await getSessionToken();
    if (token) finalHeaders["authorization"] = `Bearer ${token}`;
  }

  // Pass the real client IP / scheme through to FastAPI (see helper above).
  // Explicit `opts.headers` still win.
  const forwarded = await forwardedClientHeaders();
  for (const [k, v] of Object.entries(forwarded)) {
    if (!(k in finalHeaders)) finalHeaders[k] = v;
  }

  try {
    return await fetch(buildUrl(path, query), {
      method,
      headers: finalHeaders,
      body: finalBody,
      cache,
      signal,
    });
  } catch (cause) {
    throw ApiError.network(cause);
  }
}

/**
 * Call FastAPI and validate the JSON body against a Zod schema.
 * Throws {@link ApiError} for any non-2xx or schema failure, carrying the
 * backend `request_id` where available.
 */
export async function requestJson<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  opts: ServerRequestOptions = {},
): Promise<z.infer<S>> {
  const res = await rawRequest(path, opts);
  const requestId = res.headers.get("x-request-id") ?? undefined;

  if (!res.ok) throw await ApiError.fromResponse(res);

  let payload: unknown;
  try {
    payload = res.status === 204 ? null : await res.json();
  } catch (cause) {
    throw ApiError.parse(cause, requestId);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw ApiError.parse(parsed.error, requestId);
  }
  return parsed.data;
}
