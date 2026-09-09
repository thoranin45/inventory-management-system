"use client";

import { z } from "zod";

import { ApiError } from "./errors";

/**
 * The ONLY transport used by client components. It talks to the Next BFF
 * (`/api/bff/*` and `/api/auth/*`) — never directly to FastAPI — so the
 * bearer token stays in the server-only HttpOnly cookie and is invisible
 * to client JavaScript.
 */

type Query = Record<string, string | number | boolean | undefined | null>;

interface BrowserRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  json?: unknown;
  /** extra request headers (e.g. Idempotency-Key for PO receiving) */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

let onUnauthorized: (() => void) | null = null;
/** Registered once by SessionProvider so a 401 anywhere returns to /login. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

async function call(path: string, init: BrowserRequestInit): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json", ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  try {
    return await fetch(withQuery(path, init.query), {
      method: init.method ?? "GET",
      headers,
      body,
      signal: init.signal,
      credentials: "same-origin",
    });
  } catch (cause) {
    throw ApiError.network(cause);
  }
}

/** GET/POST/... a BFF route and validate the JSON with a Zod schema. */
export async function bffJson<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init: BrowserRequestInit = {},
): Promise<z.infer<S>> {
  const res = await call(path, init);
  const requestId = res.headers.get("x-request-id") ?? undefined;

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError({ kind: "unauthorized", status: 401, requestId });
  }
  if (!res.ok) throw await ApiError.fromResponse(res);

  let payload: unknown;
  try {
    payload = res.status === 204 ? null : await res.json();
  } catch (cause) {
    throw ApiError.parse(cause, requestId);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw ApiError.parse(parsed.error, requestId);
  return parsed.data;
}
