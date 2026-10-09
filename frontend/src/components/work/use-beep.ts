"use client";

import * as React from "react";

/**
 * Optional, user-controlled scan feedback. Three very short WebAudio tones,
 * played only *after* validation — never on a raw camera decode:
 *   ok   — a bright blip: the scan matched the expected product / line
 *   bad  — a lower buzz: wrong product, unknown barcode, over-scan, rejected
 *   done — a two-note rise: a backend write is confirmed (stock saved,
 *          picking/packing complete)
 * Off by default; the choice is remembered per-browser. Never long or loud,
 * and always paired with an on-screen icon + text.
 *
 * The preference is an external store (localStorage) read via
 * useSyncExternalStore — SSR-safe (server snapshot is `false`) and free of the
 * setState-in-effect pattern.
 */
export type BeepKind = "ok" | "bad" | "done";
const STORAGE_KEY = "wc.scan.sound";
const listeners = new Set<() => void>();

function readPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function writePref(v: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {
    /* ignore (private mode, blocked storage) */
  }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useBeep() {
  const enabled = React.useSyncExternalStore(subscribe, readPref, () => false);
  const ctxRef = React.useRef<AudioContext | null>(null);

  const setEnabled = React.useCallback((v: boolean) => writePref(v), []);

  const tone = React.useCallback(
    (kind: BeepKind) => {
      if (!enabled || typeof window === "undefined") return;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ac = (ctxRef.current ??= new AC());
        const now = ac.currentTime;

        // one short sine blip at f, starting at offset t, lasting d seconds
        const blip = (f: number, t: number, d: number) => {
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = "sine";
          osc.frequency.value = f;
          gain.gain.value = 0.04; // quiet
          osc.connect(gain).connect(ac.destination);
          osc.start(now + t);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
          osc.stop(now + t + d + 0.02);
        };

        if (kind === "ok") blip(880, 0, 0.09);
        else if (kind === "bad") blip(220, 0, 0.16);
        else {
          // "done" — a distinct two-note rise, still under a quarter second
          blip(660, 0, 0.08);
          blip(990, 0.09, 0.12);
        }
      } catch {
        /* audio unavailable — silent */
      }
    },
    [enabled],
  );

  return {
    enabled,
    setEnabled,
    tone,
    beepOk: () => tone("ok"),
    beepBad: () => tone("bad"),
    beepDone: () => tone("done"),
  };
}
