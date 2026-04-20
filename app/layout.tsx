import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "whispr — Private P2P Messaging",
  description:
    "End-to-end encrypted, peer-to-peer messaging. No servers, no logs, no accounts. Your messages vanish when you close the tab.",
  keywords: [
    "private messaging",
    "encrypted chat",
    "p2p",
    "anonymous",
    "secure",
  ],
  openGraph: {
    title: "whispr",
    description:
      "End-to-end encrypted P2P messaging. No servers, no logs.",
    type: "website",
    url: "https://whispr.pakhale.com",
  },
  twitter: {
    card: "summary",
    title: "whispr",
    description:
      "End-to-end encrypted P2P messaging. No servers, no logs.",
  },
  metadataBase: new URL("https://whispr.pakhale.com"),
  robots: { index: true, follow: true },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("dark", inter.variable)}>
      <body className="antialiased min-h-[100dvh]">
        {children}
      </body>
    </html>
  );
}
