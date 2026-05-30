import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkinBook — no-show deposits with skin in the game",
  description:
    "Refundable booking deposits held as yield-bearing USDC on Base. Show up and get it back with interest; no-show and it's slashed to the business. Built with Base MCP + Moonwell.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="aurora">
          <div className="blob3" />
        </div>
        <div className="grid-overlay" />
        <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      </body>
    </html>
  );
}
