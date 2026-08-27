"use client";

import { Check, Moon, MonitorCog, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  appearanceStorageKeys,
  defaultThemeMode,
  themeModes,
  type ThemeMode,
} from "@/lib/theme/appearance";
import {
  accentPalettes,
  defaultAccentPalette,
  type AccentPalette,
} from "@/lib/theme/palettes";

import styles from "./appearance-controls.module.css";

type AppearanceState = {
  accent: AccentPalette;
  theme: ThemeMode;
};

const serverSnapshot: AppearanceState = {
  accent: defaultAccentPalette,
  theme: defaultThemeMode,
};

const themeIcons = {
  system: MonitorCog,
  light: Sun,
  dark: Moon,
} satisfies Record<ThemeMode, typeof Sun>;

let cachedSnapshot = serverSnapshot;

function isThemeMode(value: string | undefined): value is ThemeMode {
  return themeModes.some((mode) => mode.id === value);
}

function isAccentPalette(value: string | undefined): value is AccentPalette {
  return accentPalettes.some((palette) => palette.id === value);
}

function readSnapshot(): AppearanceState {
  if (typeof document === "undefined") return serverSnapshot;

  const theme = isThemeMode(document.documentElement.dataset.theme)
    ? document.documentElement.dataset.theme
    : defaultThemeMode;
  const accent = isAccentPalette(document.documentElement.dataset.accent)
    ? document.documentElement.dataset.accent
    : defaultAccentPalette;

  if (cachedSnapshot.theme !== theme || cachedSnapshot.accent !== accent) {
    cachedSnapshot = { theme, accent };
  }

  return cachedSnapshot;
}

function subscribe(onStoreChange: () => void) {
  function handleAppearanceChange() {
    onStoreChange();
  }

  function handleStorage(event: StorageEvent) {
    if (event.key !== appearanceStorageKeys.theme && event.key !== appearanceStorageKeys.accent) return;

    let theme: string = defaultThemeMode;
    let accent: string = defaultAccentPalette;

    try {
      theme = window.localStorage.getItem(appearanceStorageKeys.theme) ?? defaultThemeMode;
      accent = window.localStorage.getItem(appearanceStorageKeys.accent) ?? defaultAccentPalette;
    } catch {
      // Keep the current document appearance when browser storage is unavailable.
    }

    document.documentElement.dataset.theme = isThemeMode(theme) ? theme : defaultThemeMode;
    document.documentElement.dataset.accent = isAccentPalette(accent) ? accent : defaultAccentPalette;
    onStoreChange();
  }

  window.addEventListener("life-os:appearance", handleAppearanceChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener("life-os:appearance", handleAppearanceChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function updateAppearance(next: AppearanceState) {
  cachedSnapshot = next;
  document.documentElement.dataset.theme = next.theme;
  document.documentElement.dataset.accent = next.accent;

  try {
    window.localStorage.setItem(appearanceStorageKeys.theme, next.theme);
    window.localStorage.setItem(appearanceStorageKeys.accent, next.accent);
  } catch {
    // The document appearance still updates when browser storage is unavailable.
  }

  window.dispatchEvent(new Event("life-os:appearance"));
}

export function AppearanceControls() {
  const appearance = useSyncExternalStore(subscribe, readSnapshot, () => serverSnapshot);

  return (
    <div className={styles.controls}>
      <fieldset className={styles.group}>
        <legend>Mode</legend>
        <p>Follow your device or choose a consistent appearance.</p>
        <div className={styles.modeGrid}>
          {themeModes.map((mode) => {
            const Icon = themeIcons[mode.id];
            const selected = appearance.theme === mode.id;
            return (
              <button
                type="button"
                key={mode.id}
                className={styles.modeButton}
                data-selected={selected || undefined}
                aria-pressed={selected}
                onClick={() => updateAppearance({ ...appearance, theme: mode.id })}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{mode.label}</span>
                {selected ? <Check className={styles.check} size={15} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Accent palette</legend>
        <p>Choose the color that carries focus and active states.</p>
        <div className={styles.paletteGrid}>
          {accentPalettes.map((palette) => {
            const selected = appearance.accent === palette.id;
            return (
              <button
                type="button"
                key={palette.id}
                className={styles.paletteButton}
                data-selected={selected || undefined}
                data-accent={palette.id}
                aria-pressed={selected}
                aria-label={`${palette.label} accent palette${selected ? ", selected" : ""}`}
                onClick={() => updateAppearance({ ...appearance, accent: palette.id })}
              >
                <span className={styles.swatch} aria-hidden="true"><span /></span>
                <span>{palette.label}</span>
                {selected ? <Check className={styles.check} size={15} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
