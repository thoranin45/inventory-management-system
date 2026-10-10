"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { setUnauthorizedHandler } from "@/lib/api/browser";
import type { UserMe } from "@/lib/api/schemas/auth";

interface SessionContextValue {
  user: UserMe;
  logout: () => Promise<void>;
  /** the reason the user was bounced, if any (shown on /login) */
  signOut: (reason?: "expired") => void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

export function SessionProvider({ user, children }: { user: UserMe; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const signOut = React.useCallback(
    (reason?: "expired") => {
      queryClient.clear();
      const next = encodeURIComponent(pathname || "/dashboard");
      const q = reason ? `?reason=${reason}&next=${next}` : `?next=${next}`;
      router.replace(`/login${q}`);
    },
    [router, pathname, queryClient],
  );

  const logout = React.useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      queryClient.clear();
      router.replace("/login");
    }
  }, [router, queryClient]);

  // Phase 14C (D10): if the authenticated identity changes under a live
  // client (account switched in another tab, then this layout re-rendered
  // with the new /auth/me), drop every cached response before paint — the
  // previous user's data, possibly less redacted, must never show for the
  // new one. Children are also keyed by user id (below), so local UI state
  // such as an open drawer cannot survive the switch either.
  const seenUserId = React.useRef(user.id);
  React.useLayoutEffect(() => {
    if (seenUserId.current !== user.id) {
      seenUserId.current = user.id;
      queryClient.clear();
    }
  }, [user.id, queryClient]);

  // Any BFF 401 anywhere → return to login (token expiry; no refresh in V1).
  React.useEffect(() => {
    setUnauthorizedHandler(() => signOut("expired"));
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = React.useMemo<SessionContextValue>(() => ({ user, logout, signOut }), [user, logout, signOut]);

  return (
    <SessionContext.Provider value={value}>
      <React.Fragment key={user.id}>{children}</React.Fragment>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
