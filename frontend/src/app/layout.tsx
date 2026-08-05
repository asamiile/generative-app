import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Generative App",
  description: "実写限定・4K画像生成アプリ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
