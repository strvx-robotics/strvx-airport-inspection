import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import { StoreProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "Strvx Runway Inspection",
  description: "AI-assisted runway inspection & work-order demo",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-zinc-50 text-zinc-900 antialiased">
        <StoreProvider>
          <Header />
          <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
        </StoreProvider>
      </body>
    </html>
  );
}
