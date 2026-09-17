import type { Metadata, Viewport } from "next";

import { AppearanceInitScript } from "@/components/appearance-init-script";
import { defaultThemeMode } from "@/lib/theme/appearance";
import { defaultAccentPalette } from "@/lib/theme/palettes";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Adulting.exe",
    template: "%s · Adulting.exe",
  },
  description: "I built this shit for myself because apparently I need software to keep my life together.",
  applicationName: "Adulting.exe",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Adulting.exe" },
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
