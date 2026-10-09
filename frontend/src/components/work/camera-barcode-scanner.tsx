"use client";

import * as React from "react";
import { CameraOff, Flashlight, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import {
  createBarcodeDecoder,
  DEFAULT_FORMATS,
  type BarcodeDecoder,
  type BarcodeFormatHint,
} from "./use-barcode-decoder";

/**
 * Reusable, BUSINESS-NEUTRAL camera barcode scanner.
 *
 *   camera  →  decode barcode  →  onDecode(string)
 *
 * It knows nothing about Stock In / Sales / PO / Transfer or any mutation.
 * Camera frames never leave the browser: pixels are read from the <video>
 * element in-page and only the decoded string is emitted. Every MediaStream
 * track is stopped on close, decode, unmount, tab-hide and acquisition error.
 */

type Phase = "idle" | "starting" | "scanning" | "denied" | "no-device" | "busy" | "error";

const DECODE_INTERVAL_MS = 90; // ~11 fps — enough to catch a code, easy on battery
const DEDUPE_MS = 1400;

export function CameraBarcodeScanner({
  open,
  onOpenChange,
  onDecode,
  formats = DEFAULT_FORMATS,
  continuous = false,
  title = "Scan a barcode",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecode: (value: string) => void;
  formats?: BarcodeFormatHint[];
  /** keep scanning after the first hit (default: close on first decode) */
  continuous?: boolean;
  title?: string;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const decoderRef = React.useRef<BarcodeDecoder | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const lastAtRef = React.useRef(0);
  const lastValueRef = React.useRef<{ v: string; t: number }>({ v: "", t: 0 });
  const aliveRef = React.useRef(false);

  const [phase, setPhase] = React.useState<Phase>("idle");
  const [engine, setEngine] = React.useState<"native" | "zxing" | null>(null);
  const [torchOn, setTorchOn] = React.useState(false);
  const [torchAvail, setTorchAvail] = React.useState(false);

  // Parents almost always pass inline callbacks; keep them in refs so the
  // camera start/stop effect never re-fires (which would tear the stream down
  // and re-acquire it) just because the parent re-rendered.
  const onDecodeRef = React.useRef(onDecode);
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    onDecodeRef.current = onDecode;
    onOpenChangeRef.current = onOpenChange;
  }, [onDecode, onOpenChange]);

  /** Pure resource cleanup — cancels the loop, disposes the decoder, stops
   *  every track, detaches the video. No React state is touched here so it is
   *  safe to call synchronously from an effect. */
  const teardown = React.useCallback(() => {
    aliveRef.current = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    decoderRef.current?.dispose();
    decoderRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) for (const t of stream.getTracks()) t.stop();
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {
        /* ignore */
      }
      v.srcObject = null;
    }
  }, []);

  const start = React.useCallback(async () => {
    teardown();
    setTorchOn(false);
    setTorchAvail(false);
    setPhase("starting");
    setEngine(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("no-device");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") setPhase("denied");
      else if (name === "NotFoundError" || name === "OverconstrainedError") setPhase("no-device");
      else if (name === "NotReadableError") setPhase("busy");
      else setPhase("error");
      return;
    }
    streamRef.current = stream;
    aliveRef.current = true;

    const v = videoRef.current;
    if (!v) {
      teardown();
      return;
    }
    v.srcObject = stream;
    v.setAttribute("playsinline", "true");
    v.muted = true;
    try {
      await v.play();
    } catch {
      /* autoplay can reject silently on iOS until a gesture; the dialog IS a gesture */
    }

    // torch capability (rarely present on iOS)
    const track = stream.getVideoTracks()[0];
    try {
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchAvail(!!caps?.torch);
    } catch {
      setTorchAvail(false);
    }

    let decoder: BarcodeDecoder;
    try {
      decoder = await createBarcodeDecoder(formats);
    } catch {
      teardown();
      setPhase("error");
      return;
    }
    if (!aliveRef.current) {
      decoder.dispose();
      return;
    }
    decoderRef.current = decoder;
    setEngine(decoder.engine);
    setPhase("scanning");

    const loop = async () => {
      if (!aliveRef.current) return;
      const now = performance.now();
      if (now - lastAtRef.current >= DECODE_INTERVAL_MS && videoRef.current && decoderRef.current) {
        lastAtRef.current = now;
        let value: string | null = null;
        try {
          value = await decoderRef.current.detect(videoRef.current);
        } catch {
          value = null;
        }
        if (value && aliveRef.current) {
          const last = lastValueRef.current;
          if (!(value === last.v && now - last.t < DEDUPE_MS)) {
            lastValueRef.current = { v: value, t: now };
            onDecodeRef.current(value);
            if (!continuous) {
              teardown();
              onOpenChangeRef.current(false);
              return;
            }
          }
        }
      }
      if (aliveRef.current) rafRef.current = requestAnimationFrame(() => void loop());
    };
    rafRef.current = requestAnimationFrame(() => void loop());
  }, [formats, continuous, teardown]);

  // open/close lifecycle. `start()` updates React state to reflect the
  // camera's status, so it is deferred a microtask to keep it out of the
  // synchronous effect body.
  React.useEffect(() => {
    if (!open) {
      teardown();
      return;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void start();
    });
    return () => {
      active = false;
      teardown();
    };
  }, [open, start, teardown]);

  // stop the camera when the tab is backgrounded (iOS suspends tracks anyway)
  React.useEffect(() => {
    if (!open) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        teardown();
        setPhase("idle");
      } else if (phase === "idle") {
        void start();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [open, phase, start, teardown]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvail(false);
    }
  };

  const errorCopy: Record<Exclude<Phase, "idle" | "starting" | "scanning">, string> = {
    denied:
      "Camera access is blocked. Allow it in your browser settings for this site, or type / hardware-scan the barcode instead.",
    "no-device": "No usable camera was found. Use the hardware scanner or type the barcode.",
    busy: "The camera is in use by another app. Close it and try again.",
    error: "The camera could not be started. Type or hardware-scan the barcode instead.",
  };
  const isError = phase === "denied" || phase === "no-device" || phase === "busy" || phase === "error";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description="Point the rear camera at the barcode. Frames stay on this device — only the decoded number is used."
        className="w-[min(520px,94vw)]"
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[var(--r-md)] bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          {phase === "scanning" ? (
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 h-[38%] w-[76%] -translate-x-1/2 -translate-y-1/2 rounded-[var(--r-sm)] border-2 border-[var(--accent)] shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]"
            />
          ) : null}
          {phase === "starting" ? (
            <div className="absolute inset-0 grid place-items-center text-[12px] text-white/80">
              Starting camera…
            </div>
          ) : null}
          {isError ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div className="flex flex-col items-center gap-3 text-[13px] text-white">
                <CameraOff aria-hidden className="h-8 w-8 text-white/70" />
                <p className="max-w-[36ch]">{errorCopy[phase as keyof typeof errorCopy]}</p>
                {phase !== "no-device" ? (
                  <Button variant="secondary" size="sm" onClick={() => void start()}>
                    <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Try again
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-[var(--muted)]">
            {phase === "scanning"
              ? engine === "native"
                ? "Scanning (device decoder)"
                : "Scanning"
              : " "}
          </p>
          <div className="flex gap-2">
            {torchAvail ? (
              <Button variant="secondary" size="sm" onClick={() => void toggleTorch()} aria-pressed={torchOn}>
                <Flashlight aria-hidden className="h-3.5 w-3.5" />
                {torchOn ? "Torch off" : "Torch"}
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                Close
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
