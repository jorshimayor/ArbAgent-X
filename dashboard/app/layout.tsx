import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofStake — x402 with skin in the game",
  description:
    "Slashable agent reputation backed by yield-bearing USDC bonds on Base. Built with Base MCP + Moonwell + x402.",
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
