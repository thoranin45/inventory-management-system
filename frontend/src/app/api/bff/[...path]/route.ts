import { NextResponse } from "next/server";

import { ApiError } from "@/lib/api/errors";
import { getSessionToken, rawRequest } from "@/lib/api/server";
import { serverConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generic authenticated proxy. Client components call `/api/bff/<fastapi path>`;
 * this handler attaches `Authorization: Bearer <token>` from the HttpOnly
 * cookie and forwards to FastAPI. The token is never visible to client JS.
 *
 * Allow-list keeps the proxy scoped to read endpoints the frontend actually
 * uses in Phase 1.
 */
const ALLOW: { method: string; pattern: RegExp }[] = [
  { method: "GET", pattern: /^dashboard\/summary$/ },
  { method: "GET", pattern: /^dashboard\/recent-transactions$/ },
  { method: "GET", pattern: /^attention\/summary$/ },
  { method: "GET", pattern: /^attention\/queues$/ },
  { method: "GET", pattern: /^search$/ },
  { method: "GET", pattern: /^products$/ },
  { method: "GET", pattern: /^products\/\d+$/ },
  { method: "GET", pattern: /^stock-balances$/ },
  { method: "GET", pattern: /^stock-balances\/in-transit$/ },
  { method: "GET", pattern: /^stock-balances\/product\/\d+$/ },

  // Phase 3 — Sales Orders. Backend enforces role (create/confirm = admin,
  // list/detail/cancel = warehouse+); the BFF only scopes which routes exist.
  { method: "GET", pattern: /^sales-orders$/ },
  { method: "GET", pattern: /^sales-orders\/\d+$/ },
  { method: "POST", pattern: /^sales-orders$/ },
  { method: "POST", pattern: /^sales-orders\/\d+\/confirm$/ },
  { method: "PUT", pattern: /^sales-orders\/\d+\/cancel$/ },
  { method: "GET", pattern: /^customers$/ },

  // Phase 4 — Picking / Packing / Scanner (all warehouse+admin on the backend).
  { method: "POST", pattern: /^sales-orders\/\d+\/start-picking$/ },
  { method: "POST", pattern: /^sales-orders\/\d+\/scan-pick$/ },
  { method: "POST", pattern: /^sales-orders\/\d+\/complete-picking$/ },
  { method: "POST", pattern: /^sales-orders\/\d+\/scan-pack$/ },
  { method: "POST", pattern: /^sales-orders\/\d+\/complete-packing$/ },
  { method: "GET", pattern: /^sales-orders\/\d+\/packing-slip-data$/ },
  { method: "GET", pattern: /^sales-orders\/\d+\/shipping-label-data$/ },
  { method: "GET", pattern: /^scan\/resolve$/ },

  // Phase 9 — Shipping / Complete / Return / Invoice / Audit. Backend enforces
  // role (ship/return = warehouse+admin, complete = admin, audit = admin).
  { method: "POST", pattern: /^sales-orders\/\d+\/ship$/ },
  { method: "POST", pattern: /^sales-orders\/\d+\/complete$/ },
  { method: "POST", pattern: /^sales-orders\/\d+\/return$/ },
  { method: "GET", pattern: /^sales-orders\/\d+\/invoice$/ },
  { method: "GET", pattern: /^audit-logs$/ },
  { method: "GET", pattern: /^audit-logs\/\d+$/ },

  // Phase 5 — Purchase Orders + Receiving. Backend enforces role
  // (create/confirm/cancel = admin, list/detail/receive = warehouse+).
  { method: "GET", pattern: /^purchase-orders$/ },
  { method: "GET", pattern: /^purchase-orders\/\d+$/ },
  { method: "POST", pattern: /^purchase-orders$/ },
  { method: "POST", pattern: /^purchase-orders\/\d+\/confirm$/ },
  { method: "POST", pattern: /^purchase-orders\/\d+\/cancel$/ },
  { method: "POST", pattern: /^purchase-orders\/\d+\/receive$/ },
  { method: "GET", pattern: /^suppliers$/ },

  // Phase 6 — Inventory Transfers + In-Transit (all warehouse+admin).
  { method: "GET", pattern: /^inventory-transfers$/ },
  { method: "GET", pattern: /^inventory-transfers\/\d+$/ },
  { method: "POST", pattern: /^inventory-transfers$/ },
  { method: "POST", pattern: /^inventory-transfers\/\d+\/dispatch$/ },
  { method: "POST", pattern: /^inventory-transfers\/\d+\/receive$/ },
  { method: "POST", pattern: /^inventory-transfers\/\d+\/cancel$/ },

  // Phase 7 — Product & Master-Data CRUD. Backend enforces role
  // (list/detail = warehouse+; create/update/delete = admin).
  { method: "GET", pattern: /^products\/search$/ },
  { method: "GET", pattern: /^products\/inactive$/ },
  { method: "POST", pattern: /^products$/ },
  { method: "PUT", pattern: /^products\/\d+$/ },
  { method: "DELETE", pattern: /^products\/\d+$/ },
  { method: "PUT", pattern: /^products\/\d+\/restore$/ },
  { method: "POST", pattern: /^products\/\d+\/upload-image$/ },

  { method: "GET", pattern: /^categories$/ },
  { method: "GET", pattern: /^categories\/\d+$/ },
  { method: "POST", pattern: /^categories$/ },
  { method: "PUT", pattern: /^categories\/\d+$/ },
  { method: "DELETE", pattern: /^categories\/\d+$/ },

  { method: "GET", pattern: /^customers\/\d+$/ },
  { method: "POST", pattern: /^customers$/ },
  { method: "PUT", pattern: /^customers\/\d+$/ },
  { method: "DELETE", pattern: /^customers\/\d+$/ },

  { method: "GET", pattern: /^suppliers\/\d+$/ },
  { method: "POST", pattern: /^suppliers$/ },
  { method: "PUT", pattern: /^suppliers\/\d+$/ },
  { method: "DELETE", pattern: /^suppliers\/\d+$/ },

  { method: "GET", pattern: /^batches$/ },
  { method: "GET", pattern: /^batches\/expiring$/ },

  // Binary FileResponse — barcode / QR PNG and the product label PDF.
  { method: "GET", pattern: /^codes\/products\/\d+\/barcode$/ },
  { method: "GET", pattern: /^codes\/products\/\d+\/qrcode$/ },
  { method: "GET", pattern: /^labels\/product\/\d+$/ },

  // Product images are served by FastAPI's StaticFiles mount at the server
  // root (outside /api/v1) — passthrough so the browser never talks to
  // FastAPI directly and no API origin is hard-coded in client code.
  { method: "GET", pattern: /^uploads\/products\/[A-Za-z0-9._-]+$/ },

  // Phase 8 — Reports (all GET, require_warehouse = both roles).
  { method: "GET", pattern: /^reports\/operational-stock$/ },
  { method: "GET", pattern: /^reports\/expired-stock$/ },
  { method: "GET", pattern: /^reports\/near-expiry-stock$/ },
  { method: "GET", pattern: /^reports\/in-transit-stock$/ },
  { method: "GET", pattern: /^reports\/low-stock-operational$/ },
  { method: "GET", pattern: /^reports\/stock-movement$/ },
  { method: "GET", pattern: /^reports\/sales$/ },
  { method: "GET", pattern: /^reports\/sales-summary$/ },
  { method: "GET", pattern: /^reports\/purchase-orders$/ },
  { method: "GET", pattern: /^reports\/transfers$/ },
  { method: "GET", pattern: /^reports\/chart\/sales$/ },
  { method: "GET", pattern: /^reports\/chart\/stock$/ },
  { method: "GET", pattern: /^reports\/chart\/expiry$/ },
  // Binary XLSX FileResponse exports.
  { method: "GET", pattern: /^reports\/export\/stock$/ },
  { method: "GET", pattern: /^reports\/export\/sales$/ },
  { method: "GET", pattern: /^reports\/export\/low-stock$/ },
  { method: "GET", pattern: /^reports\/export\/expiring$/ },
];

/** Request headers the BFF forwards upstream verbatim (allow-list). */
const FORWARD_HEADERS = ["idempotency-key"];

function isAllowed(method: string, path: string): boolean {
  return ALLOW.some((r) => r.method === method && r.pattern.test(path));
}

async function proxy(req: Request, ctx: RouteContext<"/api/bff/[...path]">) {
  const { path: segments } = await ctx.params;
  const path = (segments ?? []).join("/");
  const method = req.method.toUpperCase();

  if (!isAllowed(method, path)) {
    return NextResponse.json(
      { success: false, message: `Route not permitted through the BFF: ${method} /${path}` },
      { status: 404 },
    );
  }

  // Static product images live at the FastAPI server root, not under /api/v1.
  if (path.startsWith("uploads/")) {
    const token = await getSessionToken();
    const upstream = await fetch(`${serverConfig.apiBaseUrl}/${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/octet-stream" },
    });
  }

  const query = Object.fromEntries(new URL(req.url).searchParams.entries());

  const reqContentType = req.headers.get("content-type") ?? "";
  const isMultipart = reqContentType.toLowerCase().startsWith("multipart/form-data");

  let json: unknown;
  let rawBody: ArrayBuffer | undefined;
  if (isMultipart) {
    // Pass the multipart payload (image upload) straight through — parsing it
    // as JSON would corrupt the boundary framing. The original content-type
    // header carries the boundary and must be preserved verbatim.
    rawBody = await req.arrayBuffer();
  } else if (method !== "GET" && method !== "DELETE") {
    try {
      json = await req.json();
    } catch {
      json = undefined;
    }
  }

  const forwarded: Record<string, string> = {};
  for (const h of FORWARD_HEADERS) {
    const v = req.headers.get(h);
    if (v) forwarded[h] = v;
  }

  try {
    const upstream = await rawRequest(`/${path}`, {
      method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      query,
      json: rawBody ? undefined : json,
      body: rawBody,
      contentType: rawBody ? reqContentType : undefined,
      headers: forwarded,
    });

    const upstreamContentType = upstream.headers.get("content-type") ?? "application/json";
    const isJsonish = /^(application\/json|text\/)/i.test(upstreamContentType);
    const rid = upstream.headers.get("x-request-id");

    if (!isJsonish) {
      // Binary FileResponse (barcode / QR PNG, label PDF). Stream the bytes
      // unchanged; keep the disposition so a browser tab names the download.
      const buf = await upstream.arrayBuffer();
      const res = new NextResponse(buf, {
        status: upstream.status,
        headers: { "content-type": upstreamContentType },
      });
      const disposition = upstream.headers.get("content-disposition");
      if (disposition) res.headers.set("content-disposition", disposition);
      if (rid) res.headers.set("x-request-id", rid);
      return res;
    }

    const bodyText = await upstream.text();
    const res = new NextResponse(bodyText, {
      status: upstream.status,
      headers: { "content-type": upstreamContentType },
    });
    if (rid) res.headers.set("x-request-id", rid);
    return res;
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json(
        { success: false, message: e.userMessage, request_id: e.requestId },
        { status: e.status && e.status >= 400 ? e.status : 502 },
      );
    }
    return NextResponse.json({ success: false, message: "Upstream request failed." }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
