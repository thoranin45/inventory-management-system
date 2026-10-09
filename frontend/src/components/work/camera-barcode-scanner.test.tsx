import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CameraBarcodeScanner } from "./camera-barcode-scanner";

/* ----------------------------------------------------------------- mocks -- */

// ZXing is dynamically imported by the fallback path. Provide light stand-ins
// so the module graph resolves; the native-detector path is what most tests
// exercise.
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromCanvas() {
      throw new Error("NotFoundException");
    }
    reset() {}
  },
}));
vi.mock("@zxing/library", () => ({ BarcodeFormat: { EAN_13: 1, QR_CODE: 11 } }));

type DetectResult = { rawValue: string };
let nextDetect: DetectResult[] = [];

class FakeBarcodeDetector {
  static getSupportedFormats = vi.fn(async () => [
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
    "code_128",
    "code_39",
    "qr_code",
  ]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_opts?: { formats?: string[] }) {}
  async detect(): Promise<DetectResult[]> {
    return nextDetect;
  }
}

const tracks: Array<{ stop: ReturnType<typeof vi.fn>; getCapabilities?: () => unknown }> = [];
function makeStream() {
  const track = { stop: vi.fn(), getCapabilities: () => ({}) };
  tracks.push(track);
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  nextDetect = [];
  tracks.length = 0;
  getUserMedia = vi.fn(async () => makeStream());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeBarcodeDetector;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 640 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 480 });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  // @ts-expect-error test cleanup
  delete navigator.mediaDevices;
});

/* ----------------------------------------------------------------- tests -- */

describe("CameraBarcodeScanner", () => {
  it("does not touch the camera while closed", () => {
    render(<CameraBarcodeScanner open={false} onOpenChange={() => {}} onDecode={() => {}} />);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("requests the rear camera when opened", async () => {
    render(<CameraBarcodeScanner open onOpenChange={() => {}} onDecode={() => {}} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    const constraints = getUserMedia.mock.calls[0][0] as MediaStreamConstraints;
    expect(JSON.stringify(constraints)).toContain("environment");
    expect(constraints.audio).toBe(false);
  });

  it("emits the decoded string once and asks to close (non-continuous)", async () => {
    nextDetect = [{ rawValue: "8850000000017" }];
    const onDecode = vi.fn();
    const onOpenChange = vi.fn();
    render(<CameraBarcodeScanner open onOpenChange={onOpenChange} onDecode={onDecode} />);
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith("8850000000017"));
    expect(onDecode).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("suppresses a duplicate of the same value on consecutive frames", async () => {
    nextDetect = [{ rawValue: "REPEATED" }];
    const onDecode = vi.fn();
    render(<CameraBarcodeScanner open continuous onOpenChange={() => {}} onDecode={onDecode} />);
    await waitFor(() => expect(onDecode).toHaveBeenCalled());
    // let several more decode frames run
    await new Promise((r) => setTimeout(r, 250));
    expect(onDecode).toHaveBeenCalledTimes(1);
  });

  it("stops every media track when it closes", async () => {
    const { rerender } = render(
      <CameraBarcodeScanner open onOpenChange={() => {}} onDecode={() => {}} />,
    );
    await waitFor(() => expect(tracks.length).toBe(1));
    rerender(<CameraBarcodeScanner open={false} onOpenChange={() => {}} onDecode={() => {}} />);
    await waitFor(() => expect(tracks[0].stop).toHaveBeenCalled());
  });

  it("shows a usable fallback when permission is denied", async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    render(<CameraBarcodeScanner open onOpenChange={() => {}} onDecode={() => {}} />);
    expect(await screen.findByText(/Camera access is blocked/i)).toBeInTheDocument();
  });

  it("reports when there is no camera API at all", async () => {
    // @ts-expect-error force-remove for this test
    delete navigator.mediaDevices;
    render(<CameraBarcodeScanner open onOpenChange={() => {}} onDecode={() => {}} />);
    expect(await screen.findByText(/No usable camera/i)).toBeInTheDocument();
  });

  it("never uploads frames — no fetch and no canvas export", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL");
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    nextDetect = [{ rawValue: "8850000000017" }];
    render(<CameraBarcodeScanner open onOpenChange={() => {}} onDecode={() => {}} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 150));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(toDataURL).not.toHaveBeenCalled();
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("closing the dialog asks the parent to close", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CameraBarcodeScanner open onOpenChange={onOpenChange} onDecode={() => {}} />);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
