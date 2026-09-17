import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Adulting.exe",
    short_name: "Adulting.exe",
    description: "I built this shit for myself because apparently I need software to keep my life together.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#111827",
    theme_color: "#2563eb",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
        purpose: "any",
      },
    ],
  };
}
