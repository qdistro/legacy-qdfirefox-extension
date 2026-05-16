// page.extract module.
//
// Context-menu-driven. User selects text → right-click → "Send to…" →
// we capture {url, title, selected_text} and forward to bridge as
// `page.extract` with an intent token.
//
// Content-script injection on demand via browser.scripting.executeScript
// (MV3). Avoids the always-on permission cost of a static content
// script.
//
// @ts-check
(function (root) {
  "use strict";
  const api = root.qdistroApi;
  const dispatcher = root.qdistroDispatcher;

  async function executeInTab(tabId, func, args) {
    // Firefox MV3 exposes browser.scripting.executeScript with the
    // same shape Chromium uses. Return value is the first frame's
    // result.
    const results = await api.scripting.executeScript({
      target: { tabId },
      func,
      args: args || [],
    });
    return results && results[0] && results[0].result;
  }

  function captureSelectionFn() {
    const sel = (window.getSelection && window.getSelection().toString()) || "";
    return {
      selected_text: sel,
      url: location.href,
      title: document.title,
    };
  }

  async function capture(tabId) {
    const captured = await executeInTab(tabId, captureSelectionFn);
    return captured || { selected_text: "", url: "", title: "" };
  }

  async function extract(tabId, destination, intentToken) {
    const captured = await capture(tabId);
    return await dispatcher.request("page.extract", {
      ...captured,
      destination: destination || null,
      intent_token: intentToken || null,
    });
  }

  function installContextMenu() {
    if (!api.contextMenus) return;
    try {
      api.contextMenus.create({
        id: "qdistro-share-to",
        title: "Send to qdistro…",
        contexts: ["selection", "page", "link"],
      });
    } catch (_) { /* idempotent: already installed */ }

    api.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId !== "qdistro-share-to") return;
      if (!tab || tab.id == null) return;
      try {
        const intentToken = root.qdistroIntent
          ? await root.qdistroIntent.mint("page.extract", 5000)
          : null;
        await extract(tab.id, info.selectionText ? "selection" : "page", intentToken);
      } catch (e) {
        console.warn("[qdistro/pageExtract] failed", e);
      }
    });
  }

  root.qdistroPageExtract = { extract, capture, installContextMenu };
})(typeof self !== "undefined" ? self : globalThis);
