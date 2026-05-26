import { DEFAULT_SETTINGS } from "../shared/constants";
import { extensionApi, tabsCreate } from "../shared/browser-api";
import { loadSettings, saveSettings } from "../shared/settings";
import type { CaptureModifier, CaptureSettings, CopyFormat } from "../shared/types";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

function render(settings: CaptureSettings): void {
  if (!app) {
    return;
  }

  const shell = createElement("section", { className: "shell" });
  const header = createElement("header");
  const headerText = createElement("div");
  headerText.append(
    createElement("h1", { text: "Locus 设置" }),
    createElement("p", { text: "配置元素捕获、复制格式和定位器校验行为。" })
  );
  header.append(headerText, createButton("恢复默认", { id: "reset" }));

  const form = createElement("form", { id: "settings-form" });
  form.append(
    selectLabel<CaptureModifier>("捕获组合键", "captureModifier", settings.captureModifier, [
      ["alt", "Alt"],
      ["ctrl", "Ctrl"],
      ["shift", "Shift"],
      ["meta", "Meta"],
      ["alt+shift", "Alt + Shift"],
      ["ctrl+shift", "Ctrl + Shift"]
    ]),
    selectLabel<CopyFormat>("默认复制格式", "defaultCopyFormat", settings.defaultCopyFormat, [
      ["xpath", "XPath"],
      ["css", "CSS Selector"],
      ["text", "文本"],
      ["jsRegex", "JS 正则"],
      ["pythonRegex", "Python 正则"],
      ["json", "JSON"]
    ]),
    numberLabel("相似元素最大结果数量", "maxSimilarItems", settings.maxSimilarItems),
    checkboxLabel("enableSmartRegex", "显示智能泛化正则", settings.enableSmartRegex),
    checkboxLabel("showAbsoluteXPath", "显示绝对 XPath", settings.showAbsoluteXPath),
    commandSection(settings),
    settingsFooter()
  );

  shell.append(header, form);
  app.replaceChildren(shell);

  bind(settings);
}

type CreateOptions = {
  className?: string;
  id?: string;
  text?: string;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: CreateOptions = {}
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.id) element.id = options.id;
  if (options.text !== undefined) element.textContent = options.text;
  return element;
}

function createButton(text: string, options: CreateOptions = {}): HTMLButtonElement {
  const button = createElement("button", options);
  button.type = "button";
  button.textContent = text;
  return button;
}

function selectLabel<T extends string>(
  labelText: string,
  name: string,
  current: T,
  choices: Array<[T, string]>
): HTMLLabelElement {
  const label = createElement("label");
  const select = createElement("select");
  select.name = name;
  for (const [value, text] of choices) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = value === current;
    select.append(option);
  }
  label.append(createElement("span", { text: labelText }), select);
  return label;
}

function numberLabel(labelText: string, name: string, value: number): HTMLLabelElement {
  const label = createElement("label");
  const input = createElement("input");
  input.name = name;
  input.type = "number";
  input.min = "1";
  input.max = "100";
  input.value = String(value);
  label.append(createElement("span", { text: labelText }), input);
  return label;
}

function checkboxLabel(name: string, labelText: string, checked: boolean): HTMLLabelElement {
  const label = createElement("label", { className: "check" });
  const input = createElement("input");
  input.name = name;
  input.type = "checkbox";
  input.checked = checked;
  label.append(input, createElement("span", { text: labelText }));
  return label;
}

function commandSection(settings: CaptureSettings): HTMLElement {
  const section = createElement("section", { className: "command" });
  const copy = createElement("div");
  copy.append(
    createElement("strong", { text: "悬停捕获与校验快捷键" }),
    createElement("p", {
      text: `悬停捕获默认 ${settings.freezeCommand}，无点击捕获默认 ${settings.captureCurrentCommand}，校验默认 ${settings.validateCommand}。浏览器要求在扩展快捷键页面中修改命令快捷键。`
    })
  );
  section.append(copy, createButton("打开快捷键设置", { id: "open-shortcuts" }));
  return section;
}

function settingsFooter(): HTMLElement {
  const footer = createElement("footer");
  const submit = createButton("保存设置");
  submit.type = "submit";
  const status = createElement("span", { id: "status" });
  status.setAttribute("role", "status");
  footer.append(submit, status);
  return footer;
}

function bind(current: CaptureSettings): void {
  const form = document.querySelector<HTMLFormElement>("#settings-form");
  const status = document.querySelector<HTMLSpanElement>("#status");
  const reset = document.querySelector<HTMLButtonElement>("#reset");
  const openShortcuts = document.querySelector<HTMLButtonElement>("#open-shortcuts");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const next: CaptureSettings = {
      ...current,
      captureModifier: data.get("captureModifier") as CaptureModifier,
      defaultCopyFormat: data.get("defaultCopyFormat") as CopyFormat,
      maxSimilarItems: Number(data.get("maxSimilarItems")) || DEFAULT_SETTINGS.maxSimilarItems,
      enableSmartRegex: data.get("enableSmartRegex") === "on",
      showAbsoluteXPath: data.get("showAbsoluteXPath") === "on"
    };
    await saveSettings(next);
    if (status) {
      status.textContent = "已保存";
      window.setTimeout(() => {
        status.textContent = "";
      }, 2200);
    }
    render(next);
  });

  reset?.addEventListener("click", async () => {
    await saveSettings(DEFAULT_SETTINGS);
    render(DEFAULT_SETTINGS);
  });

  openShortcuts?.addEventListener("click", async () => {
    const isFirefox = navigator.userAgent.includes("Firefox");
    const url = isFirefox ? "about:addons" : "chrome://extensions/shortcuts";
    try {
      await tabsCreate({ url });
    } catch {
      extensionApi().runtime.openOptionsPage?.();
      if (status) {
        status.textContent = isFirefox ? "请手动打开 about:addons 修改扩展快捷键" : "请手动打开 chrome://extensions/shortcuts";
      }
    }
  });
}

void loadSettings().then(render);
