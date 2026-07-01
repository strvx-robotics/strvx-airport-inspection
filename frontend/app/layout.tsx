import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import StatusBar from "@/components/StatusBar";
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
  title: "Valanor Airfield Inspection Console",
  description:
    "Autonomous drone zone inspection: detection review, work-order lifecycle, and audit trail for airport operations.",
  icons: {
    icon: [
      {
        url: "/valanor-icon-light.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/valanor-icon-dark.png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: "/valanor-icon-light.png",
  },
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
            <main className="min-h-0 flex-1 overflow-auto bg-[#e9ecef]">
              {children}
            </main>
            <StatusBar />
          </div>
        </StoreProvider>
      </body>
    </html>
  );
}
