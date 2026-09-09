import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current session identity for client-side refresh. 401 when signed out. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
    }
    return NextResponse.json({ success: true, data: { user } });
  } catch (e) {
    const requestId = e instanceof ApiError ? e.requestId : undefined;
    return NextResponse.json(
      { success: false, message: "Could not load session.", request_id: requestId },
      { status: 502 },
    );
  }
}
