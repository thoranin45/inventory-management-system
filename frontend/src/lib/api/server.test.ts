/**
 * Transport behaviour of the BFF -> FastAPI hop (`rawRequest`), focused on
 * which client/proxy headers this server layer forwards.
 *
 * Regression cover for the Phase 11.2 fix: forwarding `X-Forwarded-Proto`
 * from the browser-facing HTTPS edge made Starlette emit absolute
 * `https://api:8081/...` trailing-slash redirects that `rawRequest`'s fetch
 * could not follow, surfacing as BFF 502 on `/sales-orders` and `/audit-logs`
 * when the external request arrived over HTTPS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const headersMock = vi.fn();
const cookiesMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
  cookies: () => cookiesMock(),
}));

import { rawRequest } from "./server";

function inbound(entries: Record<string, string>) {
  const h = new Headers(entries);
  headersMock.mockResolvedValue(h);
}

function noCookies() {
  cookiesMock.mockResolvedValue({ get: () => undefined });
}

/** Headers actually sent on the outbound FastAPI request. */
async function outboundHeaders(): Promise<Headers> {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
  );
  await rawRequest("/sales-orders", { auth: false });
  const init = fetchSpy.mock.calls[0][1]!;
  return new Headers(init.headers as HeadersInit);
}

beforeEach(() => {
  noCookies();
});
afterEach(() => {
  vi.restoreAllMocks();
  headersMock.mockReset();
  cookiesMock.mockReset();
});

describe("forwardedClientHeaders (via rawRequest)", () => {
  it("forwards nginx's authoritative X-Real-IP as a single-hop X-Forwarded-For", async () => {
    inbound({ "x-real-ip": "203.0.113.7" });
    const sent = await outboundHeaders();
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("does NOT forward X-Forwarded-Proto even when the edge terminated HTTPS", async () => {
    inbound({ "x-real-ip": "203.0.113.7", "x-forwarded-proto": "https" });
    const sent = await outboundHeaders();
    expect(sent.get("x-forwarded-proto")).toBeNull();
  });

  it("ignores a spoofed inbound X-Forwarded-For chain — only X-Real-IP is authoritative", async () => {
    inbound({
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.7",
    });
    const sent = await outboundHeaders();
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("forwards nothing when there is no proxy (no X-Real-IP)", async () => {
    inbound({ "x-forwarded-for": "1.2.3.4" });
    const sent = await outboundHeaders();
    expect(sent.get("x-forwarded-for")).toBeNull();
    expect(sent.get("x-forwarded-proto")).toBeNull();
  });

  it("outbound request to FastAPI stays plain http:// (so slash redirects resolve internally)", async () => {
    inbound({ "x-real-ip": "203.0.113.7", "x-forwarded-proto": "https" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    // These are the two endpoints that 502'd externally before the fix
    // because Next strips the trailing slash and FastAPI 307s to `/`.
    await rawRequest("/sales-orders", { auth: false });
    await rawRequest("/audit-logs", { auth: false });
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).toMatch(/^http:\/\/[^/]+\/api\/v1\//);
    }
  });
});
