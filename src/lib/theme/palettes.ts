export const accentPalettes = [
  { id: "cobalt", label: "Cobalt" },
  { id: "cyan", label: "Cyan" },
  { id: "violet", label: "Violet" },
  { id: "graphite", label: "Graphite" },
  { id: "gold", label: "Warm gold" },
] as const;

export type AccentPalette = (typeof accentPalettes)[number]["id"];

export const defaultAccentPalette: AccentPalette = "cobalt";
