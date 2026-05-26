import type { CaptureSettings } from "./types";

export const STORAGE_SETTINGS_KEY = "locusSettings";
export const STORAGE_RECENTS_KEY = "locusRecentCaptures";
export const MAX_RECENT_CAPTURES = 20;

export const DEFAULT_SETTINGS: CaptureSettings = {
  captureModifier: "ctrl+shift",
  freezeCommand: "Alt+Z",
  captureCurrentCommand: "Ctrl+Shift+Z",
  validateCommand: "Alt+X",
  defaultCopyFormat: "xpath",
  maxSimilarItems: 20,
  enableSmartRegex: true,
  showAbsoluteXPath: false
};
