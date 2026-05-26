import { buildRegexInfo } from "./regex";
import { buildElementPaths } from "./selectors";
import { getElementTextInfo } from "./text";
import type { CapturedElement } from "./types";

export function captureElement(element: Element): CapturedElement {
  const text = getElementTextInfo(element);
  return {
    frame: {
      frameId: 0,
      url: window.location.href,
      name: window.name || "",
      isTop: window.top === window
    },
    paths: buildElementPaths(element, element.ownerDocument),
    text,
    regex: buildRegexInfo(element, text),
    timestamp: Date.now()
  };
}
