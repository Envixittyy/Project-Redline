import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Life OS — Foundation",
  description: "A calm, personal system for organizing everyday life.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-accent="crimson"
      data-theme="system"
    >
      <body>{children}</body>
    </html>
  );
}
