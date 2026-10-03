import type { Metadata } from "next";
import { Caveat, Schibsted_Grotesk, IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const sans = Schibsted_Grotesk({ variable: "--font-sans-src", subsets: ["latin"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono-src", subsets: ["latin"], weight: ["400", "500", "600"] });
const serif = Newsreader({ variable: "--font-serif-src", subsets: ["latin"], weight: ["400", "500"] });
const hand = Caveat({ variable: "--font-hand-src", subsets: ["latin"], weight: ["600"] });

export const metadata: Metadata = {
  title: "Leash — spending mandates for AI agents",
  description: "Let an AI agent shop for you, inside limits you sign. Powered by PayPal.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
