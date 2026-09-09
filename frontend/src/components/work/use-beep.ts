"use client";

import * as React from "react";

/**
 * Optional, user-controlled scan feedback. Two very short WebAudio tones —
 * a bright blip for success, a lower buzz for a rejected scan. Off by default;
 * the choice is remembered per-browser. Never long or loud.
 *
 * The preference is an external store (localStorage) read via
 * useSyncExternalStore — SSR-safe (server snapshot is `false`) and free of the
 * setState-in-effect pattern.
 */
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
    (ok: boolean) => {
      if (!enabled || typeof window === "undefined") return;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ac = (ctxRef.current ??= new AC());
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = "sine";
        osc.frequency.value = ok ? 880 : 220;
        gain.gain.value = 0.04; // quiet
        osc.connect(gain).connect(ac.destination);
        const now = ac.currentTime;
        osc.start(now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + (ok ? 0.09 : 0.16));
        osc.stop(now + (ok ? 0.1 : 0.18));
      } catch {
        /* audio unavailable — silent */
      }
    },
    [enabled],
  );

  return { enabled, setEnabled, beepOk: () => tone(true), beepBad: () => tone(false) };
}
