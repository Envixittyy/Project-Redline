import { accentPalettes, defaultAccentPalette } from "./palettes";

export const themeModes = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

export type ThemeMode = (typeof themeModes)[number]["id"];

export const defaultThemeMode: ThemeMode = "system";

export const appearanceStorageKeys = {
  accent: "life-os.appearance.v1.accent",
  theme: "life-os.appearance.v1.theme",
} as const;

const validThemeModes = themeModes.map((mode) => mode.id);
const validAccentPalettes = accentPalettes.map((palette) => palette.id);

export const appearanceInitScript = `(function(){try{var r=document.documentElement;var t=localStorage.getItem(${JSON.stringify(appearanceStorageKeys.theme)});var a=localStorage.getItem(${JSON.stringify(appearanceStorageKeys.accent)});var ts=${JSON.stringify(validThemeModes)};var as=${JSON.stringify(validAccentPalettes)};r.dataset.theme=ts.indexOf(t)>-1?t:${JSON.stringify(defaultThemeMode)};r.dataset.accent=as.indexOf(a)>-1?a:${JSON.stringify(defaultAccentPalette)};var h=new Date().getHours();r.dataset.timeOfDay=(h>=5&&h<12)?"morning":(h>=12&&h<18)?"afternoon":(h>=18&&h<22)?"evening":"late-night";}catch(e){}})()`;
