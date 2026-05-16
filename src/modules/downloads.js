// downloads module.
//
// Listens to browser.downloads.onChanged and forwards state
// transitions (start / progress / complete / interrupted) to the
// bridge as `downloads.update`. The bridge re-exposes these on
// qbus-admin so the admin notification area can show downloads
// across users.
//
// Permission: `downloads`.
//
// @ts-check
(function (root) {
  "use strict";
  const api = root.qdistroApi;
  const dispatcher = root.qdistroDispatcher;

  function snapshot(item) {
    if (!item) return null;
    return {
      id: item.id,
      url: item.url || item.finalUrl || "",
      filename: item.filename || "",
      state: item.state || "in_progress",
      total_bytes: item.totalBytes || 0,
      bytes_received: item.bytesReceived || 0,
      mime: item.mime || "",
      start_time: item.startTime || null,
    };
  }

  function install() {
    if (!api.downloads || !api.downloads.onChanged) return;
    api.downloads.onChanged.addListener(async (delta) => {
      try {
        // Resolve full item — delta is sparse. Firefox returns a
        // Promise from downloads.search.
        const items = await api.downloads.search({ id: delta.id });
        const item = items && items[0];
        if (!item) return;
        dispatcher.request("downloads.update", snapshot(item))
          .catch(() => { /* fire-and-forget */ });
      } catch (_) {
        /* ignore — listener must not throw */
      }
    });
  }

  root.qdistroDownloads = { install, snapshot };
})(typeof self !== "undefined" ? self : globalThis);
