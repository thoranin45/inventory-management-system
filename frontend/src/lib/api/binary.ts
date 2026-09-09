"use client";

import { z } from "zod";

import { ApiError } from "./errors";

/**
 * Binary + multipart transport for the BFF. Kept separate from `bffJson` so
 * business components never hand-roll `fetch` for file responses or uploads.
 * Both still go through `/api/bff/*`, so the bearer token stays server-side.
 */

export interface BinaryResult {
  blob: Blob;
  /** filename parsed from Content-Disposition, if the server sent one */
  filename?: string;
  contentType: string;
  requestId?: string;
}

function filenameFromDisposition(value: string | null): string | undefined {
  if (!value) return undefined;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(value);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^"]+)"?/i.exec(value);
  return plain ? plain[1].trim() : undefined;
}

/**
 * Save a Blob to the user's device with a filename, then revoke the object
 * URL. Used for report XLSX downloads — the backend is the file generator;
 * the frontend never builds a spreadsheet.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Open a Blob in a new tab (PDF preview / print). Returns false if popup-blocked. */
export function openBlob(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return !!win;
}

/** GET a BFF route that returns a FileResponse (PNG / PDF / XLSX). */
export async function bffBinary(path: string, init: { signal?: AbortSignal } = {}): Promise<BinaryResult> {
  let res: Response;
  try {
    res = await fetch(path, { method: "GET", credentials: "same-origin", signal: init.signal });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  const requestId = res.headers.get("x-request-id") ?? undefined;
  if (res.status === 401) throw new ApiError({ kind: "unauthorized", status: 401, requestId });
  if (!res.ok) throw await ApiError.fromResponse(res);

  const blob = await res.blob();
  return {
    blob,
    filename: filenameFromDisposition(res.headers.get("content-disposition")),
    contentType: res.headers.get("content-type") ?? blob.type ?? "application/octet-stream",
    requestId,
  };
}

/** POST multipart/form-data to a BFF route and validate the JSON response. */
export async function bffUpload<S extends z.ZodTypeAny>(
  path: string,
  form: FormData,
  schema: S,
  init: { signal?: AbortSignal } = {},
): Promise<z.infer<S>> {
  let res: Response;
  try {
    // No explicit Content-Type — the browser sets it with the correct boundary.
    res = await fetch(path, { method: "POST", body: form, credentials: "same-origin", signal: init.signal });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  const requestId = res.headers.get("x-request-id") ?? undefined;
  if (res.status === 401) throw new ApiError({ kind: "unauthorized", status: 401, requestId });
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
