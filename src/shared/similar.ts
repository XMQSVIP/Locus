import { buildCssSelector, buildElementPaths, buildXPath, cssEscape, findByCss, findByXPath, xpathLiteral } from "./selectors";
import { compactSnippet, getElementTextInfo, preferredText, textShape } from "./text";
import type { SimilarElementInfo, SimilarGroupInfo } from "./types";

const GROUP_ATTRIBUTES = ["data-testid", "data-test", "data-cy", "data-qa", "role", "aria-label", "name", "title", "alt"];

function classSet(element: Element): Set<string> {
  return new Set([...element.classList].filter((className) => !/\d{4,}/.test(className)));
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }
  return count;
}

function repeatedSiblingBonus(element: Element, target: Element): number {
  const parent = element.parentElement;
  const targetParent = target.parentElement;
  if (!parent || !targetParent) {
    return 0;
  }
  if (parent === targetParent) {
    return 2;
  }
  return parent.tagName === targetParent.tagName ? 1 : 0;
}

function scoreElement(target: Element, candidate: Element): number {
  let score = 0;
  if (candidate.tagName === target.tagName) {
    score += 4;
  }

  const role = target.getAttribute("role");
  if (role && role === candidate.getAttribute("role")) {
    score += 2;
  }

  const targetClasses = classSet(target);
  const candidateClasses = classSet(candidate);
  score += Math.min(4, intersectionSize(targetClasses, candidateClasses));

  if (textShape(preferredText(getElementTextInfo(target))) === textShape(preferredText(getElementTextInfo(candidate)))) {
    score += 2;
  }

  for (const attribute of ["data-testid", "data-test", "data-cy", "aria-label", "name"]) {
    const value = target.getAttribute(attribute);
    if (value && value === candidate.getAttribute(attribute)) {
      score += 2;
    }
  }

  score += repeatedSiblingBonus(candidate, target);
  return score;
}

function tagName(element: Element): string {
  return element.tagName.toLowerCase();
}

function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isStableGroupValue(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed && trimmed.length <= 80 && !/^[a-f0-9]{16,}$/i.test(trimmed) && !/^[0-9]{8,}$/.test(trimmed));
}

function classXPathPredicate(className: string): string {
  return `contains(concat(' ', normalize-space(@class), ' '), ${xpathLiteral(` ${className} `)})`;
}

function commonClasses(elements: Element[]): string[] {
  const [first, ...rest] = elements.map(classSet);
  if (!first) {
    return [];
  }
  return [...first].filter((className) => rest.every((classes) => classes.has(className))).slice(0, 3);
}

function groupCandidate(doc: Document, target: Element, css: string, xpath: string): SimilarGroupInfo | undefined {
  try {
    const cssMatches = findByCss(doc, css);
    const xpathMatches = findByXPath(doc, xpath);
    if (cssMatches.length < 2 || xpathMatches.length < 2) {
      return undefined;
    }
    if (!cssMatches.includes(target) || !xpathMatches.includes(target)) {
      return undefined;
    }
    return {
      count: cssMatches.length,
      css,
      xpath
    };
  } catch {
    return undefined;
  }
}

function groupCandidateForSamples(
  doc: Document,
  first: Element,
  second: Element,
  css: string,
  xpath: string,
  expectedElements?: Element[]
): SimilarGroupInfo | undefined {
  try {
    const cssMatches = findByCss(doc, css);
    const xpathMatches = findByXPath(doc, xpath);
    if (cssMatches.length < 2 || xpathMatches.length < 2 || cssMatches.length !== xpathMatches.length) {
      return undefined;
    }
    if (!cssMatches.includes(first) || !cssMatches.includes(second)) {
      return undefined;
    }
    if (!xpathMatches.includes(first) || !xpathMatches.includes(second)) {
      return undefined;
    }
    if (expectedElements) {
      if (cssMatches.length !== expectedElements.length || xpathMatches.length !== expectedElements.length) {
        return undefined;
      }
      if (!expectedElements.every((element) => cssMatches.includes(element) && xpathMatches.includes(element))) {
        return undefined;
      }
    }
    return {
      count: cssMatches.length,
      css,
      xpath
    };
  } catch {
    return undefined;
  }
}

function bestGroupCandidate(candidates: SimilarGroupInfo[], desiredCount: number): SimilarGroupInfo | undefined {
  return candidates
    .filter((candidate) => candidate.count >= desiredCount)
    .sort((left, right) => Math.abs(left.count - desiredCount) - Math.abs(right.count - desiredCount))[0];
}

function buildSimilarGroup(target: Element, elements: Element[]): SimilarGroupInfo | undefined {
  if (elements.length < 2) {
    return undefined;
  }

  const doc = target.ownerDocument;
  const tag = tagName(target);
  const candidates: SimilarGroupInfo[] = [];

  for (const attribute of GROUP_ATTRIBUTES) {
    const value = target.getAttribute(attribute);
    if (!value || !isStableGroupValue(value) || !elements.every((element) => element.getAttribute(attribute) === value)) {
      continue;
    }
    const candidate = groupCandidate(
      doc,
      target,
      `${tag}[${attribute}=${cssString(value)}]`,
      `//${tag}[@${attribute}=${xpathLiteral(value)}]`
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const classes = commonClasses(elements);
  for (let length = Math.min(2, classes.length); length >= 1; length -= 1) {
    const selected = classes.slice(0, length);
    const candidate = groupCandidate(
      doc,
      target,
      `${tag}.${selected.map(cssEscape).join(".")}`,
      `//${tag}[${selected.map(classXPathPredicate).join(" and ")}]`
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  if (target.parentElement) {
    const parentCss = buildCssSelector(target.parentElement, doc);
    const parentXPath = buildXPath(target.parentElement, doc);
    const childSegment = classes.length ? `${tag}.${cssEscape(classes[0])}` : tag;
    const childXPathSegment = classes.length ? `${tag}[${classXPathPredicate(classes[0])}]` : tag;
    const candidate = groupCandidate(doc, target, `${parentCss} > ${childSegment}`, `${parentXPath}/${childXPathSegment}`);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return bestGroupCandidate(candidates, elements.length);
}

type Segment = {
  css: string;
  xpath: string;
};

type SampleAlignment = {
  rootFirst: Element;
  rootSecond: Element;
  parent: Element;
  segments: Segment[];
  targets: Element[];
};

function ancestorsFromTarget(element: Element): Element[] {
  const ancestors: Element[] = [];
  let current: Element | null = element;
  while (current && current !== current.ownerDocument.documentElement) {
    ancestors.push(current);
    current = current.parentElement;
  }
  return ancestors;
}

function sharedGroupAttribute(first: Element, second: Element): { name: string; value: string } | undefined {
  for (const attribute of GROUP_ATTRIBUTES) {
    const value = first.getAttribute(attribute);
    if (value && value === second.getAttribute(attribute) && isStableGroupValue(value)) {
      return { name: attribute, value };
    }
  }
  return undefined;
}

function segmentForPair(first: Element, second: Element): Segment | undefined {
  if (first.tagName !== second.tagName) {
    return undefined;
  }

  const tag = tagName(first);
  const attribute = sharedGroupAttribute(first, second);
  if (attribute) {
    return {
      css: `${tag}[${attribute.name}=${cssString(attribute.value)}]`,
      xpath: `${tag}[@${attribute.name}=${xpathLiteral(attribute.value)}]`
    };
  }

  const classes = [...classSet(first)].filter((className) => classSet(second).has(className)).slice(0, 2);
  if (classes.length) {
    return {
      css: `${tag}.${classes.map(cssEscape).join(".")}`,
      xpath: `${tag}[${classes.map(classXPathPredicate).join(" and ")}]`
    };
  }

  return { css: tag, xpath: tag };
}

function relativeSegments(
  firstChain: Element[],
  secondChain: Element[],
  rootIndex: number
): Segment[] | undefined {
  const segments: Segment[] = [];
  for (let index = rootIndex - 1; index >= 0; index -= 1) {
    const segment = segmentForPair(firstChain[index], secondChain[index]);
    if (!segment) {
      return undefined;
    }
    segments.push(segment);
  }
  return segments;
}

function queryDirectChildren(parent: Element, segment: Segment): Element[] {
  return [...parent.querySelectorAll(`:scope > ${segment.css}`)];
}

function queryTargetsFromRoot(root: Element, segments: Segment[]): Element[] {
  if (!segments.length) {
    return [root];
  }
  return [...root.querySelectorAll(`:scope > ${segments.map((segment) => segment.css).join(" > ")}`)];
}

function buildAlignment(first: Element, second: Element): SampleAlignment | undefined {
  if (first.ownerDocument !== second.ownerDocument || first.tagName !== second.tagName || first === second) {
    return undefined;
  }

  const firstChain = ancestorsFromTarget(first);
  const secondChain = ancestorsFromTarget(second);
  const maxDepth = Math.min(firstChain.length, secondChain.length);

  for (let rootIndex = 0; rootIndex < maxDepth; rootIndex += 1) {
    const rootFirst = firstChain[rootIndex];
    const rootSecond = secondChain[rootIndex];
    const parent = rootFirst.parentElement;
    if (!parent || parent !== rootSecond.parentElement || rootFirst === rootSecond || rootFirst.tagName !== rootSecond.tagName) {
      continue;
    }

    const rootSegment = segmentForPair(rootFirst, rootSecond);
    const childSegments = relativeSegments(firstChain, secondChain, rootIndex);
    if (!rootSegment || !childSegments) {
      continue;
    }

    const rootMatches = queryDirectChildren(parent, rootSegment);
    if (rootMatches.length < 2 || !rootMatches.includes(rootFirst) || !rootMatches.includes(rootSecond)) {
      continue;
    }

    const targets: Element[] = [];
    let oneTargetPerRoot = true;
    for (const root of rootMatches) {
      const rootTargets = queryTargetsFromRoot(root, childSegments);
      if (rootTargets.length !== 1) {
        oneTargetPerRoot = false;
        break;
      }
      targets.push(rootTargets[0]);
    }

    if (!oneTargetPerRoot || !targets.includes(first) || !targets.includes(second)) {
      continue;
    }

    return {
      rootFirst,
      rootSecond,
      parent,
      segments: [rootSegment, ...childSegments],
      targets
    };
  }

  return undefined;
}

function buildSimilarGroupFromSamples(first: Element, second: Element): { group?: SimilarGroupInfo; targets: Element[] } {
  const alignment = buildAlignment(first, second);
  if (!alignment) {
    return { targets: [] };
  }

  const doc = first.ownerDocument;
  const parentCss = buildCssSelector(alignment.parent, doc);
  const parentXPath = buildXPath(alignment.parent, doc);
  const css = `${parentCss} > ${alignment.segments.map((segment) => segment.css).join(" > ")}`;
  const xpath = `${parentXPath}/${alignment.segments.map((segment) => segment.xpath).join("/")}`;
  const group = groupCandidateForSamples(doc, first, second, css, xpath, alignment.targets);

  return {
    group,
    targets: group ? alignment.targets : []
  };
}

function toSimilarElementInfo(element: Element, index: number, score: number): SimilarElementInfo {
  return {
    index,
    score,
    tagName: element.tagName.toLowerCase(),
    text: compactSnippet(preferredText(getElementTextInfo(element)), 100),
    paths: buildElementPaths(element, element.ownerDocument)
  };
}

export function findSimilarSet(
  target: Element,
  limit: number
): { items: SimilarElementInfo[]; group?: SimilarGroupInfo } {
  const doc = target.ownerDocument;
  const candidates = [...doc.querySelectorAll(target.tagName.toLowerCase())]
    .filter((element) => element !== target)
    .slice(0, 3000)
    .map((element, index) => ({
      element,
      index,
      score: scoreElement(target, element)
    }))
    .filter((item) => item.score >= 5)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  const groupElements = [target, ...candidates.map(({ element }) => element)];
  const group = buildSimilarGroup(target, groupElements);
  const items = candidates.map(({ element, index, score }) => toSimilarElementInfo(element, index, score));

  return { items, group };
}

export function findSimilarSetFromSamples(
  first: Element,
  second: Element,
  limit: number
): { items: SimilarElementInfo[]; group?: SimilarGroupInfo; count: number } {
  if (first.ownerDocument !== second.ownerDocument || first.tagName !== second.tagName) {
    return { items: [], count: 0 };
  }

  const { group, targets } = buildSimilarGroupFromSamples(first, second);
  if (!group || !targets.length) {
    return { items: [], count: 0 };
  }

  const items = targets
    .slice(0, limit)
    .map((element, index) => toSimilarElementInfo(element, index, Math.min(scoreElement(first, element), scoreElement(second, element))));

  return {
    items,
    group,
    count: group.count
  };
}

export function findSimilarElements(target: Element, limit: number): SimilarElementInfo[] {
  return findSimilarSet(target, limit).items;
}
