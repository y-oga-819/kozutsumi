import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_JP } from "next/font/google";

import { QueryProvider } from "@/shared/query/QueryProvider";

import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-jp",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "kozutsumi",
  description: "個人特化AI秘書システム",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className={`${ibmPlexMono.variable} ${notoSansJp.variable}`}>
      <body className="mx-auto min-h-screen max-w-[480px] bg-bg-primary font-mono text-fg-default">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
