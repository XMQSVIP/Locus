export type CaptureModifier = "alt" | "ctrl" | "shift" | "meta" | "alt+shift" | "ctrl+shift";

export type CopyFormat =
  | "xpath"
  | "css"
  | "text"
  | "jsRegex"
  | "pythonRegex"
  | "json";

export interface CaptureSettings {
  captureModifier: CaptureModifier;
  freezeCommand: string;
  captureCurrentCommand: string;
  validateCommand: string;
  defaultCopyFormat: CopyFormat;
  maxSimilarItems: number;
  enableSmartRegex: boolean;
  showAbsoluteXPath: boolean;
}

export interface ElementPaths {
  xpath: string;
  absoluteXPath: string;
  css: string;
}

export interface ElementTextInfo {
  visible: string;
  raw: string;
  value: string;
  placeholder: string;
  ariaLabel: string;
  title: string;
  alt: string;
}

export interface RegexInfo {
  jsExact: string;
  jsSmart: string;
  pythonExact: string;
  pythonSmart: string;
}

export interface FrameInfo {
  frameId: number;
  url: string;
  name: string;
  isTop: boolean;
}

export interface SimilarElementInfo {
  index: number;
  score: number;
  tagName: string;
  text: string;
  paths: ElementPaths;
}

export interface SimilarGroupInfo {
  count: number;
  xpath: string;
  css: string;
}

export interface SimilarSampleInfo {
  tagName: string;
  paths: ElementPaths;
  text: string;
}

export interface SimilarSearchResult {
  frame: FrameInfo;
  samples: [SimilarSampleInfo, SimilarSampleInfo];
  group?: SimilarGroupInfo;
  items: SimilarElementInfo[];
  count: number;
  timestamp: number;
}

export interface CapturedElement {
  frame: FrameInfo;
  paths: ElementPaths;
  text: ElementTextInfo;
  regex: RegexInfo;
  similar?: {
    count: number;
    group?: SimilarGroupInfo;
    items: SimilarElementInfo[];
  };
  timestamp: number;
}

export interface ValidationRequest {
  frameId: number;
  type: "xpath" | "css";
  expression: string;
}

export interface ValidationResult {
  ok: boolean;
  count: number;
  error?: string;
  highlightDurationMs?: number;
}

export type LocusMessage =
  | { type: "LOCUS_CAPTURED"; capture: CapturedElement }
  | { type: "LOCUS_SHOW_CAPTURE"; capture: CapturedElement }
  | { type: "LOCUS_START_SIMILAR_SELECTION"; capture: CapturedElement }
  | { type: "LOCUS_START_SIMILAR_SELECTION_IN_FRAME"; capture: CapturedElement }
  | { type: "LOCUS_SIMILAR_FOUND"; result: SimilarSearchResult }
  | { type: "LOCUS_SHOW_SIMILAR"; result: SimilarSearchResult }
  | { type: "LOCUS_CANCEL_SIMILAR_SELECTION"; reason?: string }
  | { type: "LOCUS_VALIDATE"; request: ValidationRequest }
  | { type: "LOCUS_VALIDATE_IN_FRAME"; request: ValidationRequest }
  | { type: "LOCUS_TOGGLE_HOVER_CAPTURE" }
  | { type: "LOCUS_HOVER_CAPTURE_BROADCAST"; token: string; enabled: boolean }
  | { type: "LOCUS_CAPTURE_CURRENT" }
  | { type: "LOCUS_VALIDATE_CURRENT" }
  | { type: "LOCUS_FREEZE" }
  | { type: "LOCUS_FREEZE_BROADCAST"; token: string }
  | { type: "LOCUS_GET_SETTINGS" };
