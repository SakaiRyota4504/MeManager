import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "MeManager",
  description: "家族で共有する、暮らしの管理",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-dvh flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
