import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Thai } from "next/font/google";

import { getLocale } from "@/lib/i18n/server";
import { Providers } from "./providers";
import "./globals.css";

// Concept B type: IBM Plex Sans for Latin, IBM Plex Sans Thai for Thai (it
// follows Plex Sans in the font stack), IBM Plex Mono for codes. next/font
// downloads the files at build time and serves them from the app itself.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-thai",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "AKKRATHARA", template: "%s | AKKRATHARA" },
  description: "AKKRATHARA — operational inventory console.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e13" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // R2: the language is resolved on the server from the akk_lang cookie, so
  // the first HTML response already carries the right <html lang> and text.
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${plexSans.variable} ${plexThai.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
