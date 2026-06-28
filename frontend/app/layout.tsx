import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import { StoreProvider } from "@/lib/store";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-sans",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-mono",
});

export const metadata: Metadata = {
  title: "Valanor — Airport Runway Inspection",
  description: "AI-assisted drone runway inspection, review, and work orders",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="h-full">
        <StoreProvider>
          <div className="flex h-screen flex-col bg-void text-ink">
            <Header />
            <main className="min-h-0 flex-1 overflow-auto bg-[#0b0d0e]">
              {children}
            </main>
          </div>
        </StoreProvider>
      </body>
    </html>
  );
}
