export const forwardThemePresets = [
  "forward",
  "midnight",
  "arctic",
  "ocean",
  "aurora",
  "graphite",
  "lavender-night",
  "frost",
  "high-contrast",
] as const;

export const glassLevels = ["off", "subtle", "balanced", "high"] as const;
export const motionLevels = ["full", "reduced", "off"] as const;
export const surfaceTemperatures = ["cool", "neutral", "warm"] as const;
export const interfaceDensities = ["compact", "comfortable", "spacious"] as const;

export type ForwardThemePreset = (typeof forwardThemePresets)[number];
export type GlassLevel = (typeof glassLevels)[number];
export type MotionLevel = (typeof motionLevels)[number];
export type SurfaceTemperature = (typeof surfaceTemperatures)[number];
export type InterfaceDensity = (typeof interfaceDensities)[number];

/**
 * Stable preference shape for the later appearance phase. Only mode and accent
 * are currently exposed in UI; new controls must remain device-local and be
 * applied before paint through the existing appearance bootstrap.
 */
export type ForwardAppearancePreferences = {
  preset: ForwardThemePreset;
  mode: "dark" | "light" | "system";
  accentHue: string;
  intensity: number;
  surfaceTemperature: SurfaceTemperature;
  density: InterfaceDensity;
  fontScale: number;
  radiusScale: number;
  borderVisibility: number;
  shadowDepth: number;
  glass: GlassLevel;
  motion: MotionLevel;
};

export const defaultForwardAppearance: ForwardAppearancePreferences = {
  preset: "forward",
  mode: "system",
  accentHue: "cobalt",
  intensity: 1,
  surfaceTemperature: "cool",
  density: "comfortable",
  fontScale: 1,
  radiusScale: 1,
  borderVisibility: 1,
  shadowDepth: 1,
  glass: "balanced",
  motion: "full",
};
