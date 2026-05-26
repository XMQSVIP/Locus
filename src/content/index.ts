import { DEFAULT_SETTINGS, STORAGE_SETTINGS_KEY } from "../shared/constants";
import { extensionApi, runtimeSendMessage } from "../shared/browser-api";
import { captureElement } from "../shared/capture";
import { loadSettings, normalizeSettings } from "../shared/settings";
import { findByCss, findByXPath } from "../shared/selectors";
import { compactSnippet, getElementTextInfo, preferredText } from "../shared/text";
import { findSimilarSetFromSamples } from "../shared/similar";
import type {
  CapturedElement,
  CaptureModifier,
  CaptureSettings,
  ElementPaths,
  LocusMessage,
  SimilarGroupInfo,
  SimilarElementInfo,
  SimilarSampleInfo,
  SimilarSearchResult,
  ValidationRequest,
  ValidationResult
} from "../shared/types";

const HOVER_CAPTURE_REPEAT_COOLDOWN_MS = 450;
const VALIDATION_HIGHLIGHT_DURATION_MS = 2200;
const CAPTURE_HIGHLIGHT_DURATION_MS = 1200;
const VALIDATION_STATUS_DURATION_MS = 6000;

let settings: CaptureSettings = DEFAULT_SETTINGS;
let panel: LocusPanel | undefined;
let suppressClickUntil = 0;
let panelDragActive = false;
let lastCapturedElement: Element | null = null;
let lastPointer: { x: number; y: number; at: number; target: Element | null } = {
  x: 0,
  y: 0,
  at: 0,
  target: null
};
let hoverCaptureState: {
  enabled: boolean;
  candidate: Element | null;
  candidateOverlay?: HTMLElement;
  lastCaptured: Element | null;
  lastCapturedAt: number;
} = {
  enabled: false,
  candidate: null,
  lastCaptured: null,
  lastCapturedAt: 0
};
let similarSelectionState:
  | {
      first: Element;
      firstOverlay?: HTMLElement;
    }
  | undefined;

function matchesModifier(event: MouseEvent, modifier: CaptureModifier): boolean {
  const required = new Set(modifier.split("+"));
  const active = new Set<string>();
  if (event.altKey) active.add("alt");
  if (event.ctrlKey) active.add("ctrl");
  if (event.shiftKey) active.add("shift");
  if (event.metaKey) active.add("meta");

  if (required.size !== active.size) {
    return false;
  }
  for (const value of required) {
    if (!active.has(value)) {
      return false;
    }
  }
  return true;
}

function eventElement(event: Event): Element | null {
  const path = event.composedPath();
  for (const item of path) {
    if (item instanceof Element) {
      return item;
    }
  }
  return event.target instanceof Element ? event.target : null;
}

function isPanelEvent(event: Event): boolean {
  return Boolean(panel?.containsEvent(event));
}

function captureAndSend(element: Element): void {
  lastCapturedElement = element;
  highlightElements([element], CAPTURE_HIGHLIGHT_DURATION_MS);
  const capture = captureElement(element);
  void runtimeSendMessage({ type: "LOCUS_CAPTURED", capture } satisfies LocusMessage);
}

function frameInfo(): CapturedElement["frame"] {
  return {
    frameId: 0,
    url: window.location.href,
    name: window.name || "",
    isTop: window.top === window
  };
}

function sampleInfo(element: Element): SimilarSampleInfo {
  const text = getElementTextInfo(element);
  return {
    tagName: element.tagName.toLowerCase(),
    paths: captureElement(element).paths,
    text: compactSnippet(preferredText(text), 100)
  };
}

function locateCapturedElement(capture: CapturedElement): Element | undefined {
  if (lastCapturedElement?.isConnected) {
    const current = captureElement(lastCapturedElement);
    if (current.paths.xpath === capture.paths.xpath || current.paths.css === capture.paths.css) {
      return lastCapturedElement;
    }
  }

  return (
    findByXPath(document, capture.paths.xpath)[0] ??
    findByXPath(document, capture.paths.absoluteXPath)[0] ??
    findByCss(document, capture.paths.css)[0]
  );
}

function clearSimilarSelection(): void {
  similarSelectionState?.firstOverlay?.remove();
  similarSelectionState = undefined;
}

function startSimilarSelection(capture: CapturedElement): { ok: boolean; error?: string } {
  const first = locateCapturedElement(capture);
  if (!first || !isCapturableElement(first)) {
    return { ok: false, error: "无法重新定位第一个样本，请重新捕获元素。" };
  }

  clearSimilarSelection();
  similarSelectionState = {
    first,
    firstOverlay: drawHoverOverlay(first)
  };
  return { ok: true };
}

function finishSimilarSelection(second: Element): boolean {
  if (!similarSelectionState) {
    return false;
  }

  const { first } = similarSelectionState;
  if (first === second) {
    clearSimilarSelection();
    void runtimeSendMessage({
      type: "LOCUS_CANCEL_SIMILAR_SELECTION",
      reason: "请选择另一个相似元素作为第二个样本。"
    } satisfies LocusMessage);
    return true;
  }

  const similar = findSimilarSetFromSamples(first, second, settings.maxSimilarItems);
  if (!similar.group || !similar.count) {
    clearSimilarSelection();
    void runtimeSendMessage({
      type: "LOCUS_CANCEL_SIMILAR_SELECTION",
      reason: "请选择同一重复列表中的两个相似元素。"
    } satisfies LocusMessage);
    return true;
  }

  highlightElements([second], CAPTURE_HIGHLIGHT_DURATION_MS);
  const result: SimilarSearchResult = {
    frame: frameInfo(),
    samples: [sampleInfo(first), sampleInfo(second)],
    group: similar.group,
    items: similar.items,
    count: similar.count,
    timestamp: Date.now()
  };

  clearSimilarSelection();
  void runtimeSendMessage({ type: "LOCUS_SIMILAR_FOUND", result } satisfies LocusMessage);
  return true;
}

function handleElementCapture(element: Element): void {
  if (finishSimilarSelection(element)) {
    return;
  }
  captureAndSend(element);
}

function isCapturableElement(element: Element | null): element is Element {
  return Boolean(
    element &&
      element !== document.documentElement &&
      element !== document.body &&
      !panel?.containsElement(element)
  );
}

function clearHoverPreview(): void {
  hoverCaptureState.candidateOverlay?.remove();
  hoverCaptureState.candidateOverlay = undefined;
  hoverCaptureState.candidate = null;
}

function drawHoverOverlay(element: Element): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "locus-hover-overlay";
  overlay.style.cssText = [
    "position:absolute",
    "pointer-events:none",
    "z-index:2147483645",
    "border:2px solid rgba(220,38,38,.98)",
    "box-shadow:0 0 0 4px rgba(220,38,38,.14)",
    "border-radius:4px",
    "background:rgba(220,38,38,.05)"
  ].join(";");
  document.documentElement.append(overlay);

  const update = () => {
    if (!overlay.isConnected) {
      return;
    }
    const rect = element.getBoundingClientRect();
    overlay.style.left = `${Math.max(0, rect.left + window.scrollX)}px`;
    overlay.style.top = `${Math.max(0, rect.top + window.scrollY)}px`;
    overlay.style.width = `${Math.max(1, rect.width)}px`;
    overlay.style.height = `${Math.max(1, rect.height)}px`;
    requestAnimationFrame(update);
  };
  update();
  return overlay;
}

function updateHoverCandidate(element: Element | null): void {
  if (!hoverCaptureState.enabled) {
    return;
  }

  if (!isCapturableElement(element)) {
    clearHoverPreview();
    return;
  }

  if (hoverCaptureState.candidate === element) {
    return;
  }

  clearHoverPreview();
  hoverCaptureState.candidate = element;
  hoverCaptureState.candidateOverlay = drawHoverOverlay(element);
}

function captureCurrentHoverCandidate(target = hoverCaptureState.candidate): boolean {
  if (!hoverCaptureState.enabled || !isCapturableElement(target)) {
    return false;
  }

  const now = Date.now();
  if (
    hoverCaptureState.lastCaptured === target &&
    now - hoverCaptureState.lastCapturedAt < HOVER_CAPTURE_REPEAT_COOLDOWN_MS
  ) {
    return false;
  }

  hoverCaptureState.lastCaptured = target;
  hoverCaptureState.lastCapturedAt = now;
  handleElementCapture(target);
  return true;
}

function captureCurrentPointElement(): boolean {
  const recentTarget = Date.now() - lastPointer.at < 5000 ? lastPointer.target : null;
  const pointTarget =
    lastPointer.at > 0 ? document.elementFromPoint(lastPointer.x, lastPointer.y) : document.elementFromPoint(0, 0);
  const target = hoverCaptureState.candidate ?? recentTarget ?? pointTarget;
  if (!isCapturableElement(target)) {
    return false;
  }

  const now = Date.now();
  if (
    hoverCaptureState.lastCaptured === target &&
    now - hoverCaptureState.lastCapturedAt < HOVER_CAPTURE_REPEAT_COOLDOWN_MS
  ) {
    return false;
  }

  hoverCaptureState.lastCaptured = target;
  hoverCaptureState.lastCapturedAt = now;
  handleElementCapture(target);
  return true;
}

function setHoverCaptureEnabled(enabled: boolean): void {
  hoverCaptureState.enabled = enabled;
  if (!enabled) {
    clearHoverPreview();
    return;
  }

  const target =
    Date.now() - lastPointer.at < 5000
      ? lastPointer.target ?? document.elementFromPoint(lastPointer.x, lastPointer.y)
      : document.elementFromPoint(lastPointer.x, lastPointer.y);
  updateHoverCandidate(target instanceof Element ? target : null);
}

function propagateHoverCapture(enabled: boolean, token: string): void {
  for (const frame of document.querySelectorAll("iframe, frame")) {
    try {
      (frame as HTMLIFrameElement).contentWindow?.postMessage(
        { type: "LOCUS_HOVER_CAPTURE_BROADCAST", token, enabled } satisfies LocusMessage,
        "*"
      );
    } catch {
      // Cross-origin frames still accept postMessage in normal cases; ignore inaccessible frames.
    }
  }
}

function toggleHoverCaptureAcrossFrames(token: string = crypto.randomUUID()): boolean {
  const enabled = !hoverCaptureState.enabled;
  setHoverCaptureEnabled(enabled);
  propagateHoverCapture(enabled, token);
  return enabled;
}

function applyHoverCaptureBroadcast(enabled: boolean, token: string): void {
  setHoverCaptureEnabled(enabled);
  propagateHoverCapture(enabled, token);
}

function disableHoverCaptureAcrossFrames(): void {
  if (!hoverCaptureState.enabled) {
    return;
  }
  const token = crypto.randomUUID();
  setHoverCaptureEnabled(false);
  propagateHoverCapture(false, token);
  if (window.top !== window) {
    void runtimeSendMessage({ type: "LOCUS_TOGGLE_HOVER_CAPTURE" } satisfies LocusMessage);
  }
}

function onPointerMove(event: PointerEvent): void {
  if (panelDragActive) {
    clearHoverPreview();
    return;
  }
  if (isPanelEvent(event)) {
    clearHoverPreview();
    return;
  }
  const target = eventElement(event);
  lastPointer = {
    x: event.clientX,
    y: event.clientY,
    at: Date.now(),
    target
  };
  updateHoverCandidate(target);
}

function onPointerOut(event: PointerEvent): void {
  if (hoverCaptureState.enabled && !event.relatedTarget) {
    clearHoverPreview();
  }
}

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0 || isPanelEvent(event)) {
    return;
  }

  if (hoverCaptureState.enabled) {
    const target = hoverCaptureState.candidate ?? eventElement(event);
    if (isCapturableElement(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = Date.now() + 500;
      void captureCurrentHoverCandidate(target);
      return;
    }
  }

  const shouldCapture = matchesModifier(event, settings.captureModifier);
  if (!shouldCapture) {
    return;
  }

  const target = eventElement(event);
  if (!target) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  suppressClickUntil = Date.now() + 500;
  handleElementCapture(target);
}

function onClick(event: MouseEvent): void {
  if (Date.now() < suppressClickUntil) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape" && similarSelectionState) {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearSimilarSelection();
    void runtimeSendMessage({
      type: "LOCUS_CANCEL_SIMILAR_SELECTION",
      reason: "已取消相似元素选择。"
    } satisfies LocusMessage);
    return;
  }

  if (event.key === "Enter" && hoverCaptureState.enabled && !isPanelEvent(event)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void captureCurrentHoverCandidate();
    return;
  }

  if (event.key === "Escape" && hoverCaptureState.enabled) {
    event.preventDefault();
    event.stopImmediatePropagation();
    disableHoverCaptureAcrossFrames();
  }
}

function validateRequest(request: ValidationRequest): ValidationResult {
  try {
    const elements = request.type === "xpath"
      ? findByXPath(document, request.expression)
      : findByCss(document, request.expression);
    const highlightDurationMs = highlightElements(elements, VALIDATION_HIGHLIGHT_DURATION_MS);
    return { ok: true, count: elements.length, highlightDurationMs };
  } catch (error) {
    return { ok: false, count: 0, error: String(error instanceof Error ? error.message : error) };
  }
}

function highlightElements(elements: Element[], durationMs = VALIDATION_HIGHLIGHT_DURATION_MS): number {
  const styleId = "locus-highlight-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes locusFlashBorder {
        0%, 100% { opacity: 1; box-shadow: 0 0 0 2px rgba(220, 38, 38, .95), 0 0 0 6px rgba(220, 38, 38, .18); }
        50% { opacity: .25; box-shadow: 0 0 0 2px rgba(220, 38, 38, .25), 0 0 0 10px rgba(220, 38, 38, .08); }
      }
    `;
    document.documentElement.append(style);
  }

  for (const element of elements.slice(0, 30)) {
    const rect = element.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:absolute",
      `left:${Math.max(0, rect.left + window.scrollX)}px`,
      `top:${Math.max(0, rect.top + window.scrollY)}px`,
      `width:${Math.max(1, rect.width)}px`,
      `height:${Math.max(1, rect.height)}px`,
      "z-index:2147483647",
      "pointer-events:none",
      "border-radius:4px",
      "animation:locusFlashBorder .45s linear infinite"
    ].join(";");
    document.documentElement.append(overlay);
    window.setTimeout(() => overlay.remove(), durationMs);
  }
  return elements.length ? durationMs : 0;
}

class LocusPanel {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private capture: CapturedElement | undefined;
  private similarResult: SimilarSearchResult | undefined;
  private mode: "capture" | "similar" = "capture";
  private statusTimer: number | undefined;
  private validationRestoreTimer: number | undefined;
  private currentValidationField: keyof ElementPaths = "xpath";
  private panelPosition: { left: number; top: number } | undefined;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "locus-panel-host";
    this.host.style.cssText = "position:fixed;z-index:2147483647;right:16px;top:16px;";
    this.root = this.host.attachShadow({ mode: "open" });
    document.documentElement.append(this.host);
  }

  containsEvent(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  containsElement(element: Element): boolean {
    return element === this.host;
  }

  show(capture: CapturedElement): void {
    this.capture = capture;
    this.similarResult = undefined;
    this.mode = "capture";
    if (!this.host.isConnected) {
      document.documentElement.append(this.host);
    }
    this.host.style.display = "";
    this.render();
  }

  showSimilar(result: SimilarSearchResult): void {
    this.similarResult = result;
    this.mode = "similar";
    if (!this.host.isConnected) {
      document.documentElement.append(this.host);
    }
    this.host.style.display = "";
    this.render();
  }

  showStatus(message: string): void {
    this.status(message);
  }

  private render(): void {
    if (this.mode === "similar" && this.similarResult) {
      this.renderSimilar();
      return;
    }

    if (!this.capture) {
      return;
    }

    const capture = this.capture;
    const style = document.createElement("style");
    style.textContent = panelCss();

    const section = createElement("section", { className: "panel", ariaLabel: "Locus 元素定位器" });
    const header = createElement("header");
    const titleBox = createElement("div");
    titleBox.append(
      createElement("strong", { text: "Locus" }),
      createElement("span", { text: `${capture.frame.isTop ? "主页面" : "iframe"} · frame ${capture.frame.frameId}` })
    );
    header.append(
      titleBox,
      createButton("×", { className: "icon", title: "关闭", dataset: { action: "close" } })
    );

    const main = createElement("main");
    main.append(pathEditor("XPath", "xpath", capture.paths.xpath));
    if (settings.showAbsoluteXPath) {
      main.append(pathEditor("绝对 XPath", "absoluteXPath", capture.paths.absoluteXPath));
    }
    main.append(pathEditor("CSS Selector", "css", capture.paths.css));

    const textGrid = createElement("section", { className: "grid" });
    const titleAlt = [capture.text.title, capture.text.alt].filter(Boolean).join(" / ");
    for (const block of [
      textBlock("可见文本", capture.text.visible),
      textBlock("原始文本", capture.text.raw),
      textBlock("Value", capture.text.value),
      textBlock("Placeholder", capture.text.placeholder),
      textBlock("ARIA", capture.text.ariaLabel),
      textBlock("Title/Alt", titleAlt)
    ]) {
      if (block) {
        textGrid.append(block);
      }
    }
    main.append(textGrid);

    const regexSection = createElement("section");
    regexSection.append(createElement("h2", { text: "文本提取正则" }));
    regexSection.append(createElement("p", { className: "hint", text: "作用于元素 HTML，可提取文本或媒体链接，不用于定位元素。" }));
    regexSection.append(regexRow("JS 精确提取", capture.regex.jsExact));
    if (settings.enableSmartRegex) {
      regexSection.append(regexRow("JS 智能提取", capture.regex.jsSmart));
    }
    regexSection.append(regexRow("Python 精确提取", capture.regex.pythonExact));
    if (settings.enableSmartRegex) {
      regexSection.append(regexRow("Python 智能提取", capture.regex.pythonSmart));
    }
    main.append(regexSection);

    const similarSection = createElement("section", { className: "similar-start" });
    similarSection.append(
      createElement("h2", { text: "相似元素" }),
      createElement("p", { className: "hint", text: "把当前元素作为第一个样本，再捕获第二个同类元素，Locus 会生成列表表达式。" }),
      createButton("查找相似元素", { dataset: { action: "start-similar" } })
    );
    main.append(similarSection);

    const footer = createElement("footer");
    footer.append(
      createButton("复制默认格式", { dataset: { action: "copy-default" } }),
      createButton("设置", { dataset: { action: "options" } }),
      createElement("span", { id: "locus-status" })
    );
    main.append(footer);

    section.append(header, main);
    this.root.replaceChildren(style, section);
    this.bind();
    this.applyPanelPosition();
  }

  private renderSimilar(): void {
    if (!this.similarResult) {
      return;
    }

    const result = this.similarResult;
    const style = document.createElement("style");
    style.textContent = panelCss();

    const section = createElement("section", { className: "panel", ariaLabel: "Locus 相似元素" });
    const header = createElement("header");
    const titleBox = createElement("div");
    titleBox.append(
      createElement("strong", { text: "Locus 相似元素" }),
      createElement("span", { text: `${result.frame.isTop ? "主页面" : "iframe"} · 匹配 ${result.count} 个` })
    );
    header.append(
      titleBox,
      createButton("×", { className: "icon", title: "关闭", dataset: { action: "close" } })
    );

    const main = createElement("main");
    const sampleGrid = createElement("section", { className: "grid" });
    sampleGrid.append(sampleBlock("样本 1", result.samples[0]), sampleBlock("样本 2", result.samples[1]));
    main.append(sampleGrid);

    const groupSection = createElement("section");
    groupSection.append(createElement("h2", { text: "列表表达式" }));
    if (result.group) {
      groupSection.append(similarGroupBlock(result.group));
    } else {
      groupSection.append(createElement("p", { className: "empty", text: "没有生成可用的列表表达式，请选择同一父节点下结构更相近的两个元素。" }));
    }
    main.append(groupSection);

    const itemsSection = createElement("section");
    const itemsTitle = createElement("h2", { text: "候选元素 " });
    itemsTitle.append(createElement("small", { text: String(result.items.length) }));
    const itemsList = createElement("div", { className: "similar" });
    if (result.items.length) {
      itemsList.append(...result.items.map((item) => similarRow(item)));
    } else {
      itemsList.append(createElement("p", { className: "empty", text: "没有找到相似元素。" }));
    }
    itemsSection.append(itemsTitle, itemsList);
    main.append(itemsSection);

    const footer = createElement("footer");
    footer.append(
      createButton("重新选择第二个元素", { dataset: { action: "start-similar" } }),
      createButton("返回普通捕获", { dataset: { action: "back-capture" } }),
      createButton("设置", { dataset: { action: "options" } }),
      createElement("span", { id: "locus-status" })
    );
    main.append(footer);

    section.append(header, main);
    this.root.replaceChildren(style, section);
    this.bind();
    this.applyPanelPosition();
  }

  private bind(): void {
    this.root.querySelector("header")?.addEventListener("pointerdown", (event) => this.startDrag(event));

    this.root.querySelector('[data-action="close"]')?.addEventListener("click", () => {
      this.host.style.display = "none";
    });
    this.root.querySelector('[data-action="options"]')?.addEventListener("click", () => {
      extensionApi().runtime.openOptionsPage?.();
    });
    this.root.querySelectorAll('[data-action="start-similar"]').forEach((button) => {
      button.addEventListener("click", () => {
        void this.startSimilarSelection();
      });
    });
    this.root.querySelector('[data-action="back-capture"]')?.addEventListener("click", () => {
      if (this.capture) {
        this.mode = "capture";
        this.similarResult = undefined;
        this.render();
      }
    });
    this.root.querySelector('[data-action="copy-default"]')?.addEventListener("click", () => {
      void this.copy(defaultCopyText(this.capture!, settings.defaultCopyFormat));
    });

    for (const button of this.root.querySelectorAll<HTMLElement>("[data-copy]")) {
      button.addEventListener("click", () => {
        const key = button.dataset.copy as keyof ElementPaths;
        void this.copy(this.currentPathValue(key));
      });
    }

    for (const button of this.root.querySelectorAll<HTMLElement>("[data-validate]")) {
      button.addEventListener("click", () => {
        const key = button.dataset.validate as keyof ElementPaths;
        this.currentValidationField = key;
        const type = key === "css" ? "css" : "xpath";
        void this.validate(type, this.currentPathValue(key));
      });
    }

    for (const field of this.root.querySelectorAll<HTMLTextAreaElement>("[data-field]")) {
      const rememberField = () => {
        this.currentValidationField = field.dataset.field as keyof ElementPaths;
      };
      field.addEventListener("focus", rememberField);
      field.addEventListener("input", rememberField);
    }

    for (const button of this.root.querySelectorAll<HTMLElement>("[data-regex]")) {
      button.addEventListener("click", () => {
        void this.copy(button.dataset.regex ?? "");
      });
    }

    for (const button of this.root.querySelectorAll<HTMLElement>("[data-similar-copy]")) {
      button.addEventListener("click", () => {
        void this.copy(button.dataset.expression ?? "");
      });
    }

    for (const button of this.root.querySelectorAll<HTMLElement>("[data-similar-validate]")) {
      button.addEventListener("click", () => {
        const type = button.dataset.selectorType === "css" ? "css" : "xpath";
        void this.validate(type, button.dataset.expression ?? "");
      });
    }
  }

  private currentPathValue(key: keyof ElementPaths): string {
    const field = this.root.querySelector<HTMLTextAreaElement>(`[data-field="${key}"]`);
    return field?.value.trim() || this.capture?.paths[key] || "";
  }

  private async copy(value: string): Promise<void> {
    try {
      await copyText(value);
      this.status("已复制");
    } catch (error) {
      this.status(`复制失败：${String(error instanceof Error ? error.message : error)}`);
    }
  }

  private async startSimilarSelection(): Promise<void> {
    if (!this.capture) {
      this.status("请先捕获第一个样本元素。");
      return;
    }

    try {
      const response = await runtimeSendMessage<{ ok: boolean; error?: string }>({
        type: "LOCUS_START_SIMILAR_SELECTION",
        capture: this.capture
      } satisfies LocusMessage);
      this.status(response.ok ? "请选择第二个相似元素，按 Esc 取消。" : response.error || "无法开始相似元素选择。");
    } catch (error) {
      this.status(`无法开始相似元素选择：${String(error instanceof Error ? error.message : error)}`);
    }
  }

  private async validate(type: "xpath" | "css", expression: string): Promise<void> {
    const frameId = this.capture?.frame.frameId ?? this.similarResult?.frame.frameId;
    if (typeof frameId !== "number") {
      return;
    }
    const restoreAfterValidation = this.hidePanelForValidation();
    try {
      const response = await runtimeSendMessage<ValidationResult>({
        type: "LOCUS_VALIDATE",
        request: {
          frameId,
          type,
          expression
        }
      } satisfies LocusMessage);
      const message = response.ok ? `校验到 ${response.count} 个元素` : response.error || "校验失败";
      restoreAfterValidation(response.ok ? response.highlightDurationMs ?? VALIDATION_HIGHLIGHT_DURATION_MS : 0, message);
    } catch (error) {
      restoreAfterValidation(0, `校验失败：${String(error instanceof Error ? error.message : error)}`);
    }
  }

  validateCurrent(): void {
    if (!this.capture) {
      return;
    }
    const key = this.currentValidationField;
    const type = key === "css" ? "css" : "xpath";
    void this.validate(type, this.currentPathValue(key));
  }

  private status(message: string, durationMs = 2500): void {
    const status = this.root.getElementById("locus-status");
    if (status) {
      status.textContent = message;
    }
    if (this.statusTimer) {
      window.clearTimeout(this.statusTimer);
    }
    this.statusTimer = window.setTimeout(() => {
      if (status) {
        status.textContent = "";
      }
    }, durationMs);
  }

  private hidePanelForValidation(): (durationMs: number, statusMessage: string) => void {
    if (this.validationRestoreTimer) {
      window.clearTimeout(this.validationRestoreTimer);
    }
    const previousVisibility = this.host.style.visibility;
    this.host.style.visibility = "hidden";

    return (durationMs: number, statusMessage: string) => {
      this.validationRestoreTimer = window.setTimeout(() => {
        this.host.style.visibility = previousVisibility;
        this.status(statusMessage, VALIDATION_STATUS_DURATION_MS);
      }, durationMs);
    };
  }

  private startDrag(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    panelDragActive = true;
    clearHoverPreview();

    const rect = this.host.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    this.movePanel(rect.left, rect.top);

    const onMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      this.movePanel(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
    };
    const onUp = (upEvent: PointerEvent) => {
      upEvent.preventDefault();
      panelDragActive = false;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }

  private movePanel(left: number, top: number): void {
    const position = this.clampPanelPosition(left, top);
    this.panelPosition = position;
    this.host.style.left = `${position.left}px`;
    this.host.style.top = `${position.top}px`;
    this.host.style.right = "auto";
  }

  private applyPanelPosition(): void {
    if (!this.panelPosition) {
      return;
    }
    this.movePanel(this.panelPosition.left, this.panelPosition.top);
  }

  private clampPanelPosition(left: number, top: number): { left: number; top: number } {
    const rect = this.host.getBoundingClientRect();
    const width = rect.width || 430;
    const height = rect.height || 120;
    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);
    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop)
    };
  }
}

type CreateOptions = {
  className?: string;
  id?: string;
  text?: string;
  title?: string;
  ariaLabel?: string;
  dataset?: Record<string, string>;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: CreateOptions = {}
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.id) element.id = options.id;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.title) element.title = options.title;
  if (options.ariaLabel) element.setAttribute("aria-label", options.ariaLabel);
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      element.dataset[key] = value;
    }
  }
  return element;
}

function createButton(text: string, options: CreateOptions = {}): HTMLButtonElement {
  const button = createElement("button", options);
  button.type = "button";
  button.textContent = text;
  return button;
}

function pathEditor(label: string, key: keyof ElementPaths, value: string): HTMLElement {
  const wrapper = createElement("label");
  const labelText = createElement("span", { text: label });
  const textarea = createElement("textarea");
  textarea.dataset.field = key;
  textarea.rows = 2;
  textarea.value = value;

  const row = createElement("div", { className: "row" });
  row.append(
    createButton("复制", { dataset: { copy: key } }),
    createButton("校验", { dataset: { validate: key } })
  );

  wrapper.append(labelText, textarea, row);
  return wrapper;
}

function textBlock(label: string, value: string): HTMLElement | undefined {
  if (!value) {
    return undefined;
  }
  const article = createElement("article");
  article.append(createElement("span", { text: label }), createElement("p", { text: value }));
  return article;
}

function regexRow(label: string, value: string): HTMLElement {
  const row = createElement("div", { className: "regex-row" });
  row.append(
    createElement("span", { text: label }),
    createElement("code", { text: value }),
    createButton("复制", { dataset: { regex: value } })
  );
  return row;
}

function sampleBlock(label: string, sample: SimilarSampleInfo): HTMLElement {
  const article = createElement("article");
  article.append(
    createElement("span", { text: label }),
    createElement("strong", { text: sample.tagName }),
    createElement("p", { text: sample.text || "(无文本)" })
  );
  return article;
}

function similarRow(item: SimilarElementInfo): HTMLElement {
  const article = createElement("article", { className: "similar-row" });
  const content = createElement("div", { className: "similar-meta" });
  content.append(
    createElement("strong", { text: item.tagName }),
    createElement("span", { text: `score ${item.score}` }),
    createElement("p", { text: item.text || "(无文本)" })
  );
  article.append(content);
  return article;
}

function similarGroupBlock(group: SimilarGroupInfo): HTMLElement {
  const article = createElement("article", { className: "similar-group" });
  article.append(
    createElement("strong", { text: `列表表达式 · 匹配 ${group.count} 个` }),
    similarExpressionRow("XPath", "xpath", group.xpath),
    similarExpressionRow("CSS", "css", group.css)
  );
  return article;
}

function similarExpressionRow(label: string, type: "xpath" | "css", expression: string): HTMLElement {
  const row = createElement("div", { className: "similar-expression" });
  row.append(
    createElement("span", { text: label }),
    createElement("code", { text: expression }),
    createButton("复制", { dataset: { similarCopy: type, expression } }),
    createButton("校验", { dataset: { similarValidate: type, selectorType: type, expression } })
  );
  return row;
}

function defaultCopyText(capture: CapturedElement, format: CaptureSettings["defaultCopyFormat"]): string {
  if (format === "xpath") return capture.paths.xpath;
  if (format === "css") return capture.paths.css;
  if (format === "text") return preferredText(capture.text);
  if (format === "jsRegex") return capture.regex.jsSmart;
  if (format === "pythonRegex") return capture.regex.pythonSmart;
  return JSON.stringify(capture, null, 2);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.cssText = "position:fixed;left:-9999px;top:0";
  document.documentElement.append(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function panelCss(): string {
  return `
    :host { all: initial; color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    .panel { width: min(430px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: hidden; border: 1px solid #d4d8e1; border-radius: 8px; background: #fff; box-shadow: 0 20px 60px rgba(15, 23, 42, .24); color: #1f2937; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; cursor: move; user-select: none; }
    header strong { display: block; font-size: 15px; line-height: 1.2; }
    header span { display: block; margin-top: 2px; color: #64748b; font-size: 12px; }
    main { display: grid; gap: 14px; max-height: calc(100vh - 88px); overflow: auto; padding: 14px; }
    label, section { display: grid; gap: 8px; }
    label > span, h2 { margin: 0; font-size: 13px; line-height: 1.2; font-weight: 700; color: #334155; }
    h2 small { color: #64748b; font-weight: 500; }
    textarea { width: 100%; resize: vertical; min-height: 48px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #111827; background: #f8fafc; }
    button { min-height: 30px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0 10px; background: #fff; color: #111827; font: 12px/1 system-ui, sans-serif; cursor: pointer; }
    button:hover { border-color: #2563eb; color: #1d4ed8; }
    .icon { width: 30px; padding: 0; font-size: 20px; line-height: 1; }
    .row, footer { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    footer { border-top: 1px solid #e5e7eb; padding-top: 12px; }
    footer span { color: #2563eb; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    article { min-width: 0; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; background: #fbfdff; }
    article span, .regex-row > span { display: block; color: #64748b; font-size: 11px; font-weight: 700; margin-bottom: 4px; }
    article p { margin: 0; max-height: 72px; overflow: auto; color: #111827; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
    .hint { margin: 0; color: #64748b; font-size: 12px; }
    .regex-row { display: grid; grid-template-columns: 70px minmax(0, 1fr) auto; gap: 8px; align-items: start; }
    code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid #e5e7eb; border-radius: 6px; padding: 7px; color: #0f172a; background: #f8fafc; font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .regex-row code { overflow: visible; text-overflow: clip; white-space: pre-wrap; overflow-wrap: anywhere; }
    .similar { display: grid; gap: 8px; max-height: 240px; overflow: auto; }
    .similar-row { display: grid; gap: 8px; }
    .similar-group { display: grid; gap: 8px; border-color: #bfdbfe; background: #eff6ff; }
    .similar-group strong { color: #1d4ed8; font-size: 12px; }
    .similar-meta { min-width: 0; }
    .similar-row strong { font-size: 12px; }
    .similar-row span { display: inline; margin-left: 8px; }
    .similar-expression { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto auto; gap: 6px; align-items: start; }
    .similar-expression span { margin: 0; padding-top: 7px; color: #64748b; font-size: 11px; font-weight: 700; }
    .similar-expression code { white-space: normal; overflow-wrap: anywhere; max-height: 54px; overflow: auto; }
    .empty { margin: 0; color: #64748b; font-size: 12px; }
    @media (max-width: 520px) { .panel { width: calc(100vw - 20px); } .grid { grid-template-columns: 1fr; } .regex-row, .similar-expression { grid-template-columns: 1fr; } }
  `;
}

async function init(): Promise<void> {
  settings = await loadSettings();
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerout", onPointerOut, true);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", clearHoverPreview);
  window.addEventListener("message", (event) => {
    const message = event.data as LocusMessage;
    if (message?.type === "LOCUS_HOVER_CAPTURE_BROADCAST") {
      applyHoverCaptureBroadcast(message.enabled, message.token);
    }
    if (message?.type === "LOCUS_FREEZE_BROADCAST") {
      applyHoverCaptureBroadcast(true, message.token);
    }
  });

  const api = extensionApi();
  api.storage?.onChanged?.addListener((changes: Record<string, { newValue?: Partial<CaptureSettings> }>, area: string) => {
    if (area === "local" && changes[STORAGE_SETTINGS_KEY]?.newValue) {
      settings = normalizeSettings(changes[STORAGE_SETTINGS_KEY].newValue);
    }
  });
  api.runtime.onMessage.addListener(
    (message: LocusMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      if (message.type === "LOCUS_SHOW_CAPTURE") {
        panel ??= new LocusPanel();
        panel.show(message.capture);
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === "LOCUS_SHOW_SIMILAR") {
        panel ??= new LocusPanel();
        panel.showSimilar(message.result);
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === "LOCUS_START_SIMILAR_SELECTION_IN_FRAME") {
        const response = startSimilarSelection(message.capture);
        sendResponse(response);
        return false;
      }

      if (message.type === "LOCUS_CANCEL_SIMILAR_SELECTION") {
        clearSimilarSelection();
        panel?.showStatus(message.reason || "已取消相似元素选择。");
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === "LOCUS_VALIDATE_IN_FRAME") {
        sendResponse(validateRequest(message.request));
        return false;
      }

      if (message.type === "LOCUS_VALIDATE_CURRENT") {
        panel?.validateCurrent();
        sendResponse({ ok: Boolean(panel) });
        return false;
      }

      if (message.type === "LOCUS_CAPTURE_CURRENT") {
        const captured = captureCurrentPointElement();
        sendResponse({ ok: captured });
        return false;
      }

      if (message.type === "LOCUS_TOGGLE_HOVER_CAPTURE") {
        const enabled = toggleHoverCaptureAcrossFrames();
        sendResponse({ ok: true, enabled });
        return false;
      }

      if (message.type === "LOCUS_FREEZE") {
        const enabled = toggleHoverCaptureAcrossFrames();
        sendResponse({ ok: true, enabled });
        return false;
      }

      return false;
    }
  );
}

void init().catch((error) => {
  console.warn("[Locus] 初始化失败", error);
});
