import "server-only";

import { cookies } from "next/headers";

import { serverConfig } from "@/lib/config";
import { ApiError } from "./errors";
import { rawRequest, requestJson } from "./server";
import { tokenResponseSchema, userMeSchema, type UserMe } from "./schemas/auth";

const EIGHT_HOURS = 60 * 60 * 8;

/**
 * Exchange username/password for a FastAPI bearer token via the OAuth2
 * password endpoint, then persist it in a Secure HttpOnly SameSite=Lax
 * cookie. The token is never returned to the browser.
 */
export async function loginWithPassword(username: string, password: string): Promise<UserMe> {
  const form = new URLSearchParams({ username, password, grant_type: "password" });

  const token = await requestJson("/api/v1/auth/token", tokenResponseSchema, {
    method: "POST",
    body: form,
    contentType: "application/x-www-form-urlencoded",
    auth: false,
  });

  const jar = await cookies();
  jar.set(serverConfig.sessionCookieName, token.access_token, {
    httpOnly: true,
    secure: serverConfig.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: EIGHT_HOURS,
  });

  return getCurrentUser();
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(serverConfig.sessionCookieName);
}

/** GET /auth/me with the session cookie's bearer token. */
export async function getCurrentUser(): Promise<UserMe> {
  return requestJson("/api/v1/auth/me", userMeSchema);
}

/**
 * Session bootstrap for the (app) layout. Returns the user, or null when the
 * session cookie is missing / expired / rejected (401) so the layout can
 * redirect to /login.
 */
export async function getSessionUser(): Promise<UserMe | null> {
  const jar = await cookies();
  if (!jar.get(serverConfig.sessionCookieName)?.value) return null;
  try {
    return await getCurrentUser();
  } catch (e) {
    if (e instanceof ApiError && (e.kind === "unauthorized" || e.kind === "forbidden")) {
      return null;
    }
    throw e;
  }
}

export { rawRequest };
