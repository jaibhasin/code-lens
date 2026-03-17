/**
 * ─────────────────────────────────────────────────────────────────────────────
 * app/layout.tsx — Root Layout
 *
 * Sets up the global font (Geist via next/font/google) and base body styles.
 * The Geist font variable is applied to <html> so all descendants can use it.
 * Body gets the dark background + light text base from the glassmorphism theme.
 * ───────────────────────────────────────────────────────────────────────────── */

import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

/* Load Geist — a clean, modern sans-serif that pairs well with the
 * glassmorphism aesthetic. The CSS variable lets Tailwind reference it. */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

export const metadata: Metadata = {
  title: "CodeLens",
  description: "Where Engineers Are Forged Under Pressure",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geist.variable}>
      {/* bg-[#09090b] and text-zinc-100 are reinforced here for SSR —
       * globals.css @layer base also sets them, but className ensures
       * no flash of unstyled content before CSS loads. */}
      <body suppressHydrationWarning className={`${geist.className} antialiased bg-[#09090b] text-zinc-100`}>
        {children}
      </body>
    </html>
  );
}
