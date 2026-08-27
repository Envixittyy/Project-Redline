export const accentPalettes = [
  { id: "crimson", label: "Crimson" },
  { id: "ocean", label: "Ocean" },
  { id: "forest", label: "Forest" },
  { id: "violet", label: "Violet" },
  { id: "graphite", label: "Graphite" },
] as const;

export type AccentPalette = (typeof accentPalettes)[number]["id"];

export const defaultAccentPalette: AccentPalette = "crimson";
