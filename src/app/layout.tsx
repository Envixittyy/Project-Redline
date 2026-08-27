import type { Metadata } from "next";

import { appearanceInitScript, defaultThemeMode } from "@/lib/theme/appearance";
import { defaultAccentPalette } from "@/lib/theme/palettes";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Life OS",
    template: "%s · Life OS",
  },
  description: "A calm, personal system for organizing everyday life.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-accent={defaultAccentPalette}
      data-scroll-behavior="smooth"
      data-theme={defaultThemeMode}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
