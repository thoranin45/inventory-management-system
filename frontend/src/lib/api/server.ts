import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

import { API_V1, serverConfig } from "@/lib/config";
import { ApiError } from "./errors";

type Query = Record<string, string | number | boolean | undefined | null>;

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
