import { DEFAULT_SETTINGS, STORAGE_SETTINGS_KEY } from "./constants";
import { storageGet, storageSet } from "./browser-api";
import type { CaptureSettings } from "./types";

export function normalizeSettings(value: Partial<CaptureSettings> | undefined): CaptureSettings {
  const settings = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  settings.maxSimilarItems = Math.max(1, Math.min(100, Number(settings.maxSimilarItems) || 20));
  return settings;
}

export async function loadSettings(): Promise<CaptureSettings> {
  const stored = await storageGet<{ [STORAGE_SETTINGS_KEY]: Partial<CaptureSettings> }>({
    [STORAGE_SETTINGS_KEY]: DEFAULT_SETTINGS
  });
  return normalizeSettings(stored[STORAGE_SETTINGS_KEY]);
}

export async function saveSettings(settings: CaptureSettings): Promise<void> {
  await storageSet({ [STORAGE_SETTINGS_KEY]: normalizeSettings(settings) });
}

