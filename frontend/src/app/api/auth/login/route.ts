import { NextResponse } from "next/server";

import { loginWithPassword } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { loginInputSchema } from "@/lib/api/schemas/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BFF login. Browser -> here -> FastAPI /auth/token. On success the bearer
 * token is written to a Secure HttpOnly SameSite=Lax cookie by
 * `loginWithPassword`; only the user profile is returned to the browser.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  const parsed = loginInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Some of the submitted values are not valid.",
        errors: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      { status: 422 },
    );
  }

  try {
    const user = await loginWithPassword(parsed.data.username, parsed.data.password);
    return NextResponse.json({ success: true, data: { user } });
  } catch (e) {
    if (e instanceof ApiError) {
      const status = e.status && e.status >= 400 ? e.status : 502;
      return NextResponse.json(
        { success: false, message: e.userMessage, request_id: e.requestId, errors: e.details },
        { status: status === 401 ? 401 : status },
      );
    }
    return NextResponse.json({ success: false, message: "Sign-in failed." }, { status: 502 });
  }
}
