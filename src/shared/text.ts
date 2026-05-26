import type { ElementTextInfo } from "./types";

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function compactSnippet(value: string, maxLength = 120): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function textShape(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\d+(?:[.,]\d+)?/g, "#")
    .replace(/[A-Za-z]+/g, "a")
    .replace(/\p{Script=Han}+/gu, "中")
    .slice(0, 80);
}

export function getElementTextInfo(element: Element): ElementTextInfo {
  const htmlElement = element as HTMLElement;
  const input = element as HTMLInputElement | HTMLTextAreaElement;

  return {
    visible: normalizeWhitespace(stringValue(htmlElement.innerText) || element.textContent || ""),
    raw: normalizeWhitespace(element.textContent ?? ""),
    value: "value" in input ? normalizeWhitespace(stringValue(input.value)) : "",
    placeholder: "placeholder" in input ? normalizeWhitespace(stringValue(input.placeholder)) : "",
    ariaLabel: normalizeWhitespace(element.getAttribute("aria-label") ?? ""),
    title: normalizeWhitespace(element.getAttribute("title") ?? ""),
    alt: normalizeWhitespace(element.getAttribute("alt") ?? "")
  };
}

export function preferredText(text: ElementTextInfo): string {
  return (
    text.visible ||
    text.value ||
    text.placeholder ||
    text.ariaLabel ||
    text.title ||
    text.alt ||
    text.raw
  );
}
