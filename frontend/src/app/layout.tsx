import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Generative App",
  description: "Photorealistic 4K image generator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="flex h-screen flex-col overflow-hidden bg-app-bg font-sans text-ink-primary antialiased md:flex-row">
        <TooltipProvider delayDuration={200}>
          <Nav />
          <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
