import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "./route";

const post = (body: string, contentType = "application/json") =>
  POST(new Request("http://localhost/api/prefs/language", { method: "POST", headers: { "content-type": contentType }, body }));

describe("POST /api/prefs/language", () => {
  it.each(["th", "en"])("accepts %s and sets a hardened akk_lang cookie", async (locale) => {
    const res = await post(JSON.stringify({ locale }));
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^akk_lang=${locale};`));
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=31536000/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it.each([
    JSON.stringify({ locale: "fr" }),
    JSON.stringify({ locale: "TH" }),
    JSON.stringify({ locale: "<script>" }),
    JSON.stringify({}),
    JSON.stringify(null),
    JSON.stringify(["th"]),
    "not json",
  ])("rejects %s without setting a cookie", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("requires a JSON body (blocks plain cross-site form posts)", async () => {
    for (const type of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data"]) {
      const res = await post("locale=en", type);
      expect(res.status).toBe(415);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});
