import { MAX_RECENT_CAPTURES, STORAGE_RECENTS_KEY } from "../shared/constants";
import { extensionApi, storageGet, storageSet, tabsQuery, tabsSendMessage } from "../shared/browser-api";
import type { CapturedElement, LocusMessage, SimilarSearchResult, ValidationResult } from "../shared/types";

type PendingSimilarSelection = {
  frameId: number;
};

const pendingSimilarSelections = new Map<number, PendingSimilarSelection>();

async function activeTabId(): Promise<number | undefined> {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function rememberCapture(capture: CapturedElement): Promise<void> {
  const stored = await storageGet<{ [STORAGE_RECENTS_KEY]: CapturedElement[] }>({
    [STORAGE_RECENTS_KEY]: []
  });
  const recent = [capture, ...stored[STORAGE_RECENTS_KEY]].slice(0, MAX_RECENT_CAPTURES);
  await storageSet({ [STORAGE_RECENTS_KEY]: recent });
}

async function relayCapture(capture: CapturedElement, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return;
  }

  const senderFrameId = sender.frameId ?? 0;
  const pendingSimilar = pendingSimilarSelections.get(tabId);
  if (pendingSimilar && pendingSimilar.frameId !== senderFrameId) {
    await cancelSimilarSelection(
      tabId,
      "请在同一 iframe/页面内选择第二个相似元素。",
      pendingSimilar.frameId
    );
    return;
  }

  const framedCapture: CapturedElement = {
    ...capture,
    frame: {
      ...capture.frame,
      frameId: senderFrameId
    }
  };

  await rememberCapture(framedCapture);
  await tabsSendMessage(tabId, { type: "LOCUS_SHOW_CAPTURE", capture: framedCapture } satisfies LocusMessage, {
    frameId: 0
  });
}

async function startSimilarSelection(
  request: LocusMessage & { type: "LOCUS_START_SIMILAR_SELECTION" },
  sender: chrome.runtime.MessageSender
): Promise<{ ok: boolean; error?: string }> {
  const tabId = sender.tab?.id ?? (await activeTabId());
  if (typeof tabId !== "number") {
    return { ok: false, error: "无法找到当前标签页。" };
  }

  if (pendingSimilarSelections.has(tabId)) {
    await cancelSimilarSelection(tabId, "已切换相似元素选择。");
  }

  const frameId = request.capture.frame.frameId;
  const response = await tabsSendMessage<{ ok: boolean; error?: string }>(
    tabId,
    { type: "LOCUS_START_SIMILAR_SELECTION_IN_FRAME", capture: request.capture } satisfies LocusMessage,
    { frameId }
  );

  if (!response.ok) {
    return response;
  }

  pendingSimilarSelections.set(tabId, {
    frameId
  });
  return { ok: true };
}

async function relaySimilarResult(result: SimilarSearchResult, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return;
  }

  const frameId = sender.frameId ?? 0;
  const pending = pendingSimilarSelections.get(tabId);
  if (pending && pending.frameId !== frameId) {
    await cancelSimilarSelection(tabId, "请在同一 iframe/页面内选择第二个相似元素。", pending.frameId);
    return;
  }

  pendingSimilarSelections.delete(tabId);
  const framedResult: SimilarSearchResult = {
    ...result,
    frame: {
      ...result.frame,
      frameId
    }
  };

  await tabsSendMessage(tabId, { type: "LOCUS_SHOW_SIMILAR", result: framedResult } satisfies LocusMessage, {
    frameId: 0
  });
}

async function cancelSimilarSelection(tabId: number, reason: string, frameId?: number): Promise<void> {
  const pending = pendingSimilarSelections.get(tabId);
  pendingSimilarSelections.delete(tabId);
  const targetFrameId = frameId ?? pending?.frameId;

  if (typeof targetFrameId === "number") {
    await tabsSendMessage(
      tabId,
      { type: "LOCUS_CANCEL_SIMILAR_SELECTION", reason } satisfies LocusMessage,
      { frameId: targetFrameId }
    ).catch(() => undefined);
  }

  await tabsSendMessage(
    tabId,
    { type: "LOCUS_CANCEL_SIMILAR_SELECTION", reason } satisfies LocusMessage,
    { frameId: 0 }
  ).catch(() => undefined);
}

async function validateInFrame(
  request: LocusMessage & { type: "LOCUS_VALIDATE" },
  sender: chrome.runtime.MessageSender
): Promise<ValidationResult> {
  const tabId = sender.tab?.id ?? (await activeTabId());
  if (typeof tabId !== "number") {
    return { ok: false, count: 0, error: "无法找到当前标签页。" };
  }

  return tabsSendMessage<ValidationResult>(
    tabId,
    { type: "LOCUS_VALIDATE_IN_FRAME", request: request.request } satisfies LocusMessage,
    { frameId: request.request.frameId }
  );
}

async function sendHoverCaptureToggle(tabId?: number): Promise<void> {
  const resolvedTabId = tabId ?? (await activeTabId());
  if (typeof resolvedTabId !== "number") {
    return;
  }
  await tabsSendMessage(resolvedTabId, { type: "LOCUS_TOGGLE_HOVER_CAPTURE" } satisfies LocusMessage, { frameId: 0 });
}

async function sendValidateCurrent(tabId?: number): Promise<void> {
  const resolvedTabId = tabId ?? (await activeTabId());
  if (typeof resolvedTabId !== "number") {
    return;
  }
  await tabsSendMessage(resolvedTabId, { type: "LOCUS_VALIDATE_CURRENT" } satisfies LocusMessage, { frameId: 0 });
}

async function sendCaptureCurrent(tabId?: number): Promise<void> {
  const resolvedTabId = tabId ?? (await activeTabId());
  if (typeof resolvedTabId !== "number") {
    return;
  }
  await tabsSendMessage(resolvedTabId, { type: "LOCUS_CAPTURE_CURRENT" } satisfies LocusMessage, { frameId: 0 });
}

export function installBackground(): void {
  const api = extensionApi();

  api.runtime.onMessage.addListener(
    (message: LocusMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      if (message.type === "LOCUS_CAPTURED") {
        relayCapture(message.capture, sender)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
        return true;
      }

      if (message.type === "LOCUS_VALIDATE") {
        validateInFrame(message, sender)
          .then(sendResponse)
          .catch((error) => sendResponse({ ok: false, count: 0, error: String(error?.message ?? error) }));
        return true;
      }

      if (message.type === "LOCUS_START_SIMILAR_SELECTION") {
        startSimilarSelection(message, sender)
          .then(sendResponse)
          .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
        return true;
      }

      if (message.type === "LOCUS_SIMILAR_FOUND") {
        relaySimilarResult(message.result, sender)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
        return true;
      }

      if (message.type === "LOCUS_CANCEL_SIMILAR_SELECTION") {
        const tabId = sender.tab?.id;
        if (typeof tabId === "number") {
          cancelSimilarSelection(tabId, message.reason || "已取消相似元素选择。", sender.frameId)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
          return true;
        }
        sendResponse({ ok: false, error: "无法找到当前标签页。" });
        return false;
      }

      if (message.type === "LOCUS_FREEZE") {
        sendHoverCaptureToggle(sender.tab?.id)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
        return true;
      }

      if (message.type === "LOCUS_TOGGLE_HOVER_CAPTURE") {
        sendHoverCaptureToggle(sender.tab?.id)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
        return true;
      }

      if (message.type === "LOCUS_VALIDATE_CURRENT") {
        sendValidateCurrent(sender.tab?.id)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
        return true;
      }

      if (message.type === "LOCUS_CAPTURE_CURRENT") {
        sendCaptureCurrent(sender.tab?.id)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
        return true;
      }

      return false;
    }
  );

  api.commands?.onCommand?.addListener((command: string, tab?: chrome.tabs.Tab) => {
    if (command === "locus-freeze-capture") {
      void sendHoverCaptureToggle(tab?.id);
    }
    if (command === "locus-capture-current") {
      void sendCaptureCurrent(tab?.id);
    }
    if (command === "locus-validate-current") {
      void sendValidateCurrent(tab?.id);
    }
  });
}
