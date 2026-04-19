import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whispr — Encrypted P2P Chat",
  description:
    "Privacy-first, peer-to-peer encrypted ephemeral chat. No servers, no logs, no traces.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-whispr-bg text-whispr-text font-mono antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
