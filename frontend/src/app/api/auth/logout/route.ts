import { NextResponse } from "next/server";

import { logout } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clears the HttpOnly session cookie. */
export async function POST() {
  await logout();
  return NextResponse.json({ success: true });
}
