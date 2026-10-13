import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DOT Tasks",
  description: "整理待办，分清轻重缓急，让 DOT 持续推进。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
