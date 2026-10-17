import { NextResponse } from "next/server";

import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, isLocale } from "@/lib/i18n/config";
import { serverConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persist the UI language (Concept B R2). Presentation-only: no auth, no
 * backend call, not part of the BFF. Only "th" / "en" are accepted.
 *
 * Requiring a JSON body means a cross-site form cannot submit it without a
 * CORS preflight, which this route does not grant. The cookie is HttpOnly
 * (the server passes the value to the client provider) and SameSite=Lax;
 * Secure follows the same rule as the session cookie.
 */
export async function POST(req: Request) {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ success: false, message: "Expected application/json." }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }
  const locale = body !== null && typeof body === "object" ? (body as { locale?: unknown }).locale : undefined;
  if (!isLocale(locale)) {
    return NextResponse.json({ success: false, message: "Unsupported language." }, { status: 400 });
  }
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(LANG_COOKIE, locale, {
    path: "/",
    maxAge: LANG_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: serverConfig.cookieSecure,
  });
  return res;
}
