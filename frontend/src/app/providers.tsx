"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

import { isApiError } from "@/lib/api/errors";
import type { Locale } from "@/lib/i18n/config";
import { LanguageProvider } from "@/lib/i18n/client";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (isApiError(error) && ["unauthorized", "forbidden", "validation", "not_found"].includes(error.kind)) {
            return false;
          }
          return failureCount < 1;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children, locale }: { children: React.ReactNode; locale: Locale }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {/* D1: new visitors start in Light. An explicit choice already saved by
          next-themes (same default storage key) is kept untouched. */}
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        <LanguageProvider initialLocale={locale}>{children}</LanguageProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--surface-raised)",
              color: "var(--foreground)",
              border: "1px solid var(--border-strong)",
              fontFamily: "var(--font-body)",
            },
          }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
