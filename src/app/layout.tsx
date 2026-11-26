import type { Metadata, Viewport } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600"], style: ["italic", "normal"], variable: "--font-serif-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Merod — Unified trading", template: "%s · Merod" },
  description: "Trade stocks and crypto manually, by prompt, with shortcut buttons, or with fleets of AI agents.",
};
export const viewport: Viewport = { themeColor: "#0a0908", width: "device-width", initialScale: 1 };

const themeScript = `try{var t=localStorage.getItem('merod-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
