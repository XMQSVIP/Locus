import type { ElementTextInfo } from "./types";

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

function escapeRegexPattern(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

type RegexExtraction = {
  groupName: "value" | "text";
  exactPrefix: string;
  exactBody: string;
  exactSuffix?: string;
  smartPrefix: string;
  smartBody: string;
  smartSuffix?: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const STRUCTURAL_ATTRIBUTES = ["id", "data-testid", "data-test", "data-cy", "data-qa", "role", "name"];

function isStableAttributeValue(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed && trimmed.length <= 80 && !/^[a-f0-9]{16,}$/i.test(trimmed));
}

function stableClassNames(element: Element): string[] {
  return [...element.classList].filter((className) => !/\d{4,}/.test(className)).slice(0, 2);
}

function attributeLookahead(attribute: string, value: string): string {
  return `(?=[^>]*\\b${escapeRegexPattern(attribute)}\\s*=\\s*["']${escapeRegexPattern(value)}["'])`;
}

function classLookahead(className: string): string {
  return `(?=[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${escapeRegexPattern(className)}\\b)`;
}

function openingTagPattern(element: Element, includeHints: boolean): string {
  const tagName = element.localName.toLowerCase();
  const hints: string[] = [];

  if (includeHints) {
    for (const attribute of STRUCTURAL_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value && isStableAttributeValue(value)) {
        hints.push(attributeLookahead(attribute, value));
        break;
      }
    }

    hints.push(...stableClassNames(element).map(classLookahead));
  }

  return `<${escapeRegexPattern(tagName)}\\b${hints.join("")}[^>]*>`;
}

function buildTextExtraction(element: Element): RegexExtraction {
  const tagName = element.localName.toLowerCase();
  return {
    groupName: "text",
    exactPrefix: openingTagPattern(element, true),
    exactBody: String.raw`[\s\S]*?`,
    exactSuffix: `<\\/${escapeRegexPattern(tagName)}>`,
    smartPrefix: openingTagPattern(element, false),
    smartBody: String.raw`[\s\S]*?`,
    smartSuffix: `<\\/${escapeRegexPattern(tagName)}>`
  };
}

type MediaLink = {
  rootTag: string;
  attrName: "src" | "srcset" | "poster";
  value: string;
  childTag?: "img" | "source";
};

function cleanAttribute(value: string | null | undefined): string {
  return normalizeText(value ?? "");
}

function propertyValue(element: Element, key: "currentSrc" | "src" | "poster"): string {
  const value = (element as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? normalizeText(value) : "";
}

function mediaAttribute(element: Element, attrName: MediaLink["attrName"]): string {
  return cleanAttribute(element.getAttribute(attrName));
}

function firstValue(...values: string[]): string {
  return values.find(Boolean) ?? "";
}

function findMediaLink(element: Element): MediaLink | undefined {
  const tagName = element.localName.toLowerCase();

  if (tagName === "img") {
    const attrName = element.hasAttribute("src") ? "src" : "srcset";
    const value = firstValue(mediaAttribute(element, attrName), propertyValue(element, "currentSrc"), propertyValue(element, "src"));
    return value ? { rootTag: "img", attrName, value } : undefined;
  }

  if (tagName === "source") {
    const attrName = element.hasAttribute("src") ? "src" : "srcset";
    const value = firstValue(mediaAttribute(element, attrName), propertyValue(element, "src"));
    return value ? { rootTag: "source", attrName, value } : undefined;
  }

  if (tagName === "picture") {
    const image = element.querySelector("img");
    if (image) {
      const attrName = image.hasAttribute("src") ? "src" : "srcset";
      const value = firstValue(mediaAttribute(image, attrName), propertyValue(image, "currentSrc"), propertyValue(image, "src"));
      if (value) {
        return { rootTag: "picture", childTag: "img", attrName, value };
      }
    }

    const source = element.querySelector("source");
    if (source) {
      const attrName = source.hasAttribute("src") ? "src" : "srcset";
      const value = firstValue(mediaAttribute(source, attrName), propertyValue(source, "src"));
      if (value) {
        return { rootTag: "picture", childTag: "source", attrName, value };
      }
    }
  }

  if (tagName === "video" || tagName === "audio") {
    const ownSrc = firstValue(mediaAttribute(element, "src"), propertyValue(element, "currentSrc"), propertyValue(element, "src"));
    if (ownSrc) {
      return { rootTag: tagName, attrName: "src", value: ownSrc };
    }

    const source = element.querySelector("source");
    if (source) {
      const sourceSrc = firstValue(mediaAttribute(source, "src"), propertyValue(source, "src"));
      if (sourceSrc) {
        return { rootTag: tagName, childTag: "source", attrName: "src", value: sourceSrc };
      }
    }

    if (tagName === "video") {
      const poster = firstValue(mediaAttribute(element, "poster"), propertyValue(element, "poster"));
      if (poster) {
        return { rootTag: "video", attrName: "poster", value: poster };
      }
    }
  }

  return undefined;
}

function mediaPrefix(link: MediaLink, attrName = link.attrName): string {
  const root = `<${escapeRegexPattern(link.rootTag)}\\b[\\s\\S]*?`;
  const child = link.childTag ? `<${escapeRegexPattern(link.childTag)}\\b[\\s\\S]*?` : "";
  return `${root}${child}\\b${escapeRegexPattern(attrName)}\\s*=\\s*["']`;
}

function buildMediaExtraction(element: Element): RegexExtraction | undefined {
  const link = findMediaLink(element);
  if (!link) {
    return undefined;
  }

  const exactPrefix = mediaPrefix(link);

  return {
    groupName: "value",
    exactPrefix,
    exactBody: escapeRegexPattern(link.value),
    exactSuffix: `["']`,
    smartPrefix: exactPrefix,
    smartBody: String.raw`[^"'<>]+`,
    smartSuffix: `["']`
  };
}

function buildExtraction(element: Element, _textInfo: ElementTextInfo): RegexExtraction {
  return buildMediaExtraction(element) ?? buildTextExtraction(element);
}

function namedGroup(groupName: RegexExtraction["groupName"], body: string, flavor: "js" | "python"): string {
  return flavor === "python" ? `(?P<${groupName}>${body})` : `(?<${groupName}>${body})`;
}

function renderPattern(
  extraction: RegexExtraction,
  mode: "exact" | "smart",
  flavor: "js" | "python"
): string {
  const prefix = mode === "exact" ? extraction.exactPrefix : extraction.smartPrefix;
  const body = mode === "exact" ? extraction.exactBody : extraction.smartBody;
  const suffix = mode === "exact" ? extraction.exactSuffix ?? "" : extraction.smartSuffix ?? "";
  return `${prefix}${namedGroup(extraction.groupName, body, flavor)}${suffix}`;
}

function pythonStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function jsRegexConstructor(pattern: string): string {
  return `new RegExp(${JSON.stringify(pattern)})`;
}

function jsExtractor(pattern: string, groupName: string): string {
  if (groupName === "text") {
    return [
      `const rawText = html.match(${jsRegexConstructor(pattern)})?.groups?.text ?? "";`,
      `const text = rawText.replace(/<[^>]+>/g, " ").replace(/&ZeroWidthSpace;|&#8203;|&#x200B;/gi, "").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\\s+/g, " ").trim();`
    ].join("\n");
  }
  return `const ${groupName} = html.match(${jsRegexConstructor(pattern)})?.groups?.${groupName} ?? "";`;
}

function pythonExtractor(pattern: string, groupName: string): string {
  if (groupName === "text") {
    return [
      `match = re.search(${pythonStringLiteral(pattern)}, html)`,
      `raw_text = match.group("text") if match else ""`,
      `text = " ".join(re.sub(r"<[^>]+>", " ", raw_text).replace("&ZeroWidthSpace;", "").replace("&#8203;", "").replace("&#x200B;", "").replace("&nbsp;", " ").replace("&#160;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'").replace("&apos;", "'").split())`
    ].join("\n");
  }
  return `match = re.search(${pythonStringLiteral(pattern)}, html)\n${groupName} = match.group("${groupName}") if match else ""`;
}

export function buildRegexInfo(element: Element, textInfo: ElementTextInfo) {
  const extraction = buildExtraction(element, textInfo);
  const jsExactPattern = renderPattern(extraction, "exact", "js");
  const jsSmartPattern = renderPattern(extraction, "smart", "js");
  const pythonExactPattern = renderPattern(extraction, "exact", "python");
  const pythonSmartPattern = renderPattern(extraction, "smart", "python");

  return {
    jsExact: jsExtractor(jsExactPattern, extraction.groupName),
    jsSmart: jsExtractor(jsSmartPattern, extraction.groupName),
    pythonExact: pythonExtractor(pythonExactPattern, extraction.groupName),
    pythonSmart: pythonExtractor(pythonSmartPattern, extraction.groupName)
  };
}
