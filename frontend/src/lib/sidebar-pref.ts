import * as React from "react";

/**
 * Desktop sidebar preference: the full 236 px menu or the 76 px icon rail.
 * Kept per browser in localStorage (a convenience, not data); any storage
 * failure simply leaves the menu expanded.
 */
const KEY = "akk_sidebar";
const listeners = new Set<() => void>();
/** Used only when storage is blocked, so the toggle still works until reload. */
let memory: boolean | null = null;

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(KEY, "collapsed");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the change still applies until reload */
    memory = collapsed;
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSidebarCollapsed(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => memory ?? read(),
    () => false,
  );
}
