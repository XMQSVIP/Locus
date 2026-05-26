import { extensionApi, runtimeSendMessage, tabsQuery, tabsSendMessage } from "../shared/browser-api";
import type { CapturedElement, LocusMessage } from "../shared/types";
import { STORAGE_RECENTS_KEY } from "../shared/constants";
import { storageGet } from "../shared/browser-api";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

async function latestCapture(): Promise<CapturedElement | undefined> {
  const stored = await storageGet<{ [STORAGE_RECENTS_KEY]: CapturedElement[] }>({
    [STORAGE_RECENTS_KEY]: []
  });
  return stored[STORAGE_RECENTS_KEY][0];
}

async function sendHoverCaptureToggle(): Promise<void> {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (typeof tabId === "number") {
    await tabsSendMessage(tabId, { type: "LOCUS_TOGGLE_HOVER_CAPTURE" } satisfies LocusMessage, { frameId: 0 });
    return;
  }
  await runtimeSendMessage({ type: "LOCUS_TOGGLE_HOVER_CAPTURE" } satisfies LocusMessage);
}

function render(recent?: CapturedElement): void {
  if (!app) {
    return;
  }
  const section = createElement("section");
  const header = createElement("header");
  header.append(createElement("strong", { text: "Locus" }), createElement("span", { text: "元素定位器" }));

  const article = createElement("article");
  article.append(
    createElement("span", { text: "最近捕获" }),
    createElement("p", { text: recent ? recent.paths.xpath : "暂无记录" })
  );

  const usage = createElement("article");
  usage.append(
    createElement("span", { text: "使用方法" }),
    createElement("p", { text: "捕获元素后可复制 XPath/CSS/正则；点击面板里的“查找相似元素”，再捕获第二个样本即可生成列表表达式。" })
  );

  const author = createElement("article");
  author.append(
    createElement("span", { text: "插件信息" }),
    createElement("p", { text: "插件作者：玛卡巴卡大王，关注微信公众号：大王的琅琊阁" })
  );

  section.append(
    header,
    createButton("悬停捕获", { id: "freeze" }),
    createButton("打开设置", { id: "options" }),
    article,
    usage,
    author,
    createElement("p", { id: "status" })
  );
  app.replaceChildren(section);

  document.querySelector<HTMLButtonElement>("#freeze")?.addEventListener("click", async () => {
    const status = document.querySelector<HTMLParagraphElement>("#status");
    try {
      await sendHoverCaptureToggle();
      if (status) status.textContent = "已切换悬停捕获";
      window.close();
    } catch (error) {
      if (status) status.textContent = `当前页面不可用：${String(error instanceof Error ? error.message : error)}`;
    }
  });

  document.querySelector<HTMLButtonElement>("#options")?.addEventListener("click", () => {
    extensionApi().runtime.openOptionsPage();
  });
}

type CreateOptions = {
  id?: string;
  text?: string;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: CreateOptions = {}
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
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

void latestCapture().then(render);
