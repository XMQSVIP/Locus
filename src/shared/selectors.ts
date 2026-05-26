import type { ElementPaths } from "./types";

const STABLE_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  "name",
  "aria-label",
  "role",
  "title",
  "alt"
];

export function xpathLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(', "\"", ')})`;
}

export function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;
  if (css?.escape) {
    return css.escape(value);
  }

  return value.replace(/(^-?\d)|[^A-Za-z0-9_-]/g, (match) => {
    const code = match.codePointAt(0)?.toString(16) ?? "0";
    return `\\${code} `;
  });
}

function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isElement(value: Node | null): value is Element {
  return Boolean(value && value.nodeType === Node.ELEMENT_NODE);
}

function tagName(element: Element): string {
  return element.tagName.toLowerCase();
}

function isStableValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) {
    return false;
  }
  if (/^[a-f0-9]{16,}$/i.test(trimmed)) {
    return false;
  }
  if (/^[0-9]{8,}$/.test(trimmed)) {
    return false;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return false;
  }
  return true;
}

function stableAttribute(element: Element): { name: string; value: string } | undefined {
  const id = element.getAttribute("id");
  if (id && isStableValue(id)) {
    return { name: "id", value: id };
  }

  for (const name of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value && isStableValue(value)) {
      return { name, value };
    }
  }
  return undefined;
}

function stableClasses(element: Element): string[] {
  return [...element.classList].filter(isStableValue).filter((className) => !/\d{4,}/.test(className));
}

function classXPathPredicate(className: string): string {
  return `contains(concat(' ', normalize-space(@class), ' '), ${xpathLiteral(` ${className} `)})`;
}

function classXPathSegment(element: Element): string | undefined {
  const classes = stableClasses(element).slice(0, 2);
  if (!classes.length) {
    return undefined;
  }
  return `${tagName(element)}[${classes.map(classXPathPredicate).join(" and ")}]`;
}

function uniqueXPath(doc: Document, xpath: string, element: Element): boolean {
  try {
    const snapshot = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return snapshot.snapshotLength === 1 && snapshot.snapshotItem(0) === element;
  } catch {
    return false;
  }
}

function uniqueCss(doc: Document, selector: string, element: Element): boolean {
  try {
    const result = doc.querySelectorAll(selector);
    return result.length === 1 && result[0] === element;
  } catch {
    return false;
  }
}

function nthOfType(element: Element): number {
  let index = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === element.tagName) {
      index += 1;
    }
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function needsIndex(element: Element): boolean {
  const parent = element.parentElement;
  if (!parent) {
    return false;
  }
  return [...parent.children].filter((child) => child.tagName === element.tagName).length > 1;
}

function xpathSegment(element: Element, includePosition: boolean): string {
  const tag = tagName(element);
  const attr = stableAttribute(element);
  if (attr && attr.name !== "id") {
    const base = `${tag}[@${attr.name}=${xpathLiteral(attr.value)}]`;
    return includePosition && needsIndex(element) ? `${base}[${nthOfType(element)}]` : base;
  }
  const classSegment = classXPathSegment(element);
  if (classSegment) {
    return includePosition && needsIndex(element) ? `${classSegment}[${nthOfType(element)}]` : classSegment;
  }
  if (includePosition && needsIndex(element)) {
    return `${tag}[${nthOfType(element)}]`;
  }
  return tag;
}

export function buildAbsoluteXPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current) {
    const segment = needsIndex(current) ? `${tagName(current)}[${nthOfType(current)}]` : tagName(current);
    segments.unshift(segment);
    current = current.parentElement;
  }
  return `/${segments.join("/")}`;
}

export function buildXPath(element: Element, doc: Document = element.ownerDocument): string {
  const attr = stableAttribute(element);
  if (attr) {
    const candidate = attr.name === "id"
      ? `//*[@id=${xpathLiteral(attr.value)}]`
      : `//${tagName(element)}[@${attr.name}=${xpathLiteral(attr.value)}]`;
    if (uniqueXPath(doc, candidate, element)) {
      return candidate;
    }
  }

  const classSegment = classXPathSegment(element);
  if (classSegment) {
    const candidate = `//${classSegment}`;
    if (uniqueXPath(doc, candidate, element)) {
      return candidate;
    }
  }

  const descriptive = buildXPathFromSegments(element, doc, false);
  if (descriptive) {
    return descriptive;
  }

  return buildXPathFromSegments(element, doc, true) ?? buildAbsoluteXPath(element);
}

function buildXPathFromSegments(element: Element, doc: Document, includePosition: boolean): string | undefined {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && isElement(current)) {
    const segment = xpathSegment(current, includePosition);
    segments.unshift(segment);
    if (current !== element) {
      const candidate = `//${segments.join("/")}`;
      if (uniqueXPath(doc, candidate, element)) {
        return candidate;
      }
    }
    current = current.parentElement;
  }
  const candidate = `/${segments.join("/")}`;
  return includePosition ? candidate : undefined;
}

function cssSegment(element: Element, includePosition: boolean): string {
  const tag = tagName(element);
  const attr = stableAttribute(element);
  if (attr?.name === "id") {
    return `#${cssEscape(attr.value)}`;
  }
  if (attr) {
    const base = `${tag}[${attr.name}=${cssString(attr.value)}]`;
    return includePosition && needsIndex(element) ? `${base}:nth-of-type(${nthOfType(element)})` : base;
  }

  const classes = stableClasses(element).slice(0, 2);
  const classPart = classes.length ? `.${classes.map(cssEscape).join(".")}` : "";
  const nth = includePosition && needsIndex(element) ? `:nth-of-type(${nthOfType(element)})` : "";
  return `${tag}${classPart}${nth}`;
}

export function buildCssSelector(element: Element, doc: Document = element.ownerDocument): string {
  const attr = stableAttribute(element);
  if (attr?.name === "id") {
    const candidate = `#${cssEscape(attr.value)}`;
    if (uniqueCss(doc, candidate, element)) {
      return candidate;
    }
  }
  if (attr) {
    const candidate = `${tagName(element)}[${attr.name}=${cssString(attr.value)}]`;
    if (uniqueCss(doc, candidate, element)) {
      return candidate;
    }
  }

  const classes = stableClasses(element).slice(0, 2);
  if (classes.length) {
    const candidate = `${tagName(element)}.${classes.map(cssEscape).join(".")}`;
    if (uniqueCss(doc, candidate, element)) {
      return candidate;
    }
  }

  const descriptive = buildCssFromSegments(element, doc, false);
  if (descriptive) {
    return descriptive;
  }

  return buildCssFromSegments(element, doc, true) ?? cssSegment(element, true);
}

function buildCssFromSegments(element: Element, doc: Document, includePosition: boolean): string | undefined {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && isElement(current)) {
    segments.unshift(cssSegment(current, includePosition));
    const selector = segments.join(" > ");
    if (uniqueCss(doc, selector, element)) {
      return selector;
    }
    current = current.parentElement;
  }
  return includePosition ? segments.join(" > ") : undefined;
}

export function buildElementPaths(element: Element, doc: Document = element.ownerDocument): ElementPaths {
  return {
    xpath: buildXPath(element, doc),
    absoluteXPath: buildAbsoluteXPath(element),
    css: buildCssSelector(element, doc)
  };
}

export function findByXPath(doc: Document, expression: string): Element[] {
  const snapshot = doc.evaluate(expression, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const elements: Element[] = [];
  for (let index = 0; index < snapshot.snapshotLength; index += 1) {
    const item = snapshot.snapshotItem(index);
    if (isElement(item)) {
      elements.push(item);
    }
  }
  return elements;
}

export function findByCss(doc: Document, selector: string): Element[] {
  return [...doc.querySelectorAll(selector)];
}
