import "server-only";

/**
 * Server-only configuration. None of these are exposed to the browser
 * (no NEXT_PUBLIC_ prefix). Imported exclusively by Route Handlers and
 * Server Components.
 */
export const serverConfig = {
  /** FastAPI base URL, no trailing slash. */
  apiBaseUrl: (process.env.API_BASE_URL ?? "http://localhost:8081").replace(/\/+$/, ""),
  /** HttpOnly cookie that holds the FastAPI bearer token. */
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "wc_session",
  /** Mark the session cookie Secure (production / https). */
  cookieSecure: process.env.COOKIE_SECURE === "1" || process.env.NODE_ENV === "production",
} as const;

export const API_V1 = "/api/v1";
