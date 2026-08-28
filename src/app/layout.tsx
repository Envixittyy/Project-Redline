import type { Metadata, Viewport } from "next";

import { AppearanceInitScript } from "@/components/appearance-init-script";
import { defaultThemeMode } from "@/lib/theme/appearance";
import { defaultAccentPalette } from "@/lib/theme/palettes";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Forward",
    template: "%s · Forward",
  },
  description: "A private personal command center. Be curious, not judgmental.",
  applicationName: "Forward",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Forward" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Required for env(safe-area-inset-*) to resolve on notched devices and in
  // an installed standalone window; the shell relies on those insets.
  viewportFit: "cover",
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
      <body>
        <AppearanceInitScript />
        {children}
      </body>
    </html>
  );
}
