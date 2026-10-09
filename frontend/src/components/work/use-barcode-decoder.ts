"use client";

/**
 * Barcode decode engine abstraction — business-neutral.
 *
 * Strategy:
 *   1. native `BarcodeDetector` when the browser ships it (Chrome/Edge,
 *      Android). Fast, zero bundle cost.
 *   2. otherwise a dynamically-imported ZXing reader (works on iPhone / iPad
 *      Safari, which has no `BarcodeDetector`). Loaded only when the camera
 *      is actually opened, so it never inflates a route's initial bundle.
 *
 * A decoder never touches the network. It reads pixels from a <video> element
 * and returns the decoded string.
 */

export type BarcodeFormatHint =
  | "ean_13"
  | "ean_8"
  | "upc_a"
  | "upc_e"
  | "code_128"
  | "code_39"
  | "qr_code";

export const DEFAULT_FORMATS: BarcodeFormatHint[] = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "qr_code",
];

export interface BarcodeDecoder {
  readonly engine: "native" | "zxing";
  /** Decode the current <video> frame. Resolves `null` when no code is found. */
  detect(video: HTMLVideoElement): Promise<string | null>;
  /** Release any engine resources. Idempotent. */
  dispose(): void;
}

// --- native BarcodeDetector -------------------------------------------------

interface NativeDetectedBarcode {
  rawValue: string;
}
interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<NativeDetectedBarcode[]>;
}
interface NativeBarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

function nativeCtor(): NativeBarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

/** True when the browser can decode barcodes natively. */
export function hasNativeBarcodeDetector(): boolean {
  return nativeCtor() !== null;
}

async function createNativeDecoder(formats: BarcodeFormatHint[]): Promise<BarcodeDecoder | null> {
  const Ctor = nativeCtor();
  if (!Ctor) return null;
  let supported: string[] | null = null;
  try {
    supported = (await Ctor.getSupportedFormats?.()) ?? null;
  } catch {
    supported = null;
  }
  const wanted = supported ? formats.filter((f) => supported!.includes(f)) : formats;
  if (supported && wanted.length === 0) return null; // native present but useless for us
  const detector = new Ctor({ formats: wanted });
  return {
    engine: "native",
    async detect(video) {
      try {
        const found = await detector.detect(video);
        return found[0]?.rawValue?.trim() || null;
      } catch {
        return null;
      }
    },
    dispose() {
      /* nothing to release */
    },
  };
}

// --- ZXing fallback -------------------------------------------------------

const ZXING_FORMAT: Partial<Record<BarcodeFormatHint, string>> = {
  ean_13: "EAN_13",
  ean_8: "EAN_8",
  upc_a: "UPC_A",
  upc_e: "UPC_E",
  code_128: "CODE_128",
  code_39: "CODE_39",
  qr_code: "QR_CODE",
};

async function createZxingDecoder(formats: BarcodeFormatHint[]): Promise<BarcodeDecoder> {
  const [{ BrowserMultiFormatReader }, lib] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map<number, unknown>();
  const wanted = formats
    .map((f) => ZXING_FORMAT[f])
    .filter(Boolean)
    .map((name) => (lib.BarcodeFormat as unknown as Record<string, number>)[name as string]);
  // DecodeHintType.POSSIBLE_FORMATS = 2
  hints.set(2, wanted);
  const reader = new BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 120 });

  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

  return {
    engine: "zxing",
    async detect(video) {
      if (!canvas || !video.videoWidth) return null;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const result = (reader as unknown as { decodeFromCanvas(c: HTMLCanvasElement): { getText(): string } }).decodeFromCanvas(
          canvas,
        );
        return result.getText().trim() || null;
      } catch {
        return null; // NotFoundException on a frame with no code — expected
      }
    },
    dispose() {
      try {
        (reader as unknown as { reset?: () => void }).reset?.();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Pick the best available engine. Never throws for "no engine" — callers get
 *  a rejected promise only on a genuine ZXing load failure. */
export async function createBarcodeDecoder(
  formats: BarcodeFormatHint[] = DEFAULT_FORMATS,
): Promise<BarcodeDecoder> {
  const native = await createNativeDecoder(formats);
  if (native) return native;
  return createZxingDecoder(formats);
}
