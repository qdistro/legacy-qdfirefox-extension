// mpris module.
//
// Inbound `mpris.control` (play/pause/next/prev): handled in
// content/mpris-content.js; the dispatcher here just registers a
// stub that the content-script forwarder can replace.
//
// Outbound: wire op is `mpris.publish` (NOT `mpris.update`) per the
// bridge handler's whitelist: (title, artist, album, playback_status,
// position_us, tab_id). The content script reports {state, position
// in seconds}; we translate here so the content script doesn't need
// to know the bridge's field naming.
//
// @ts-check
(function (root) {
  "use strict";
  const dispatcher = root.qdistroDispatcher;

  dispatcher.register("mpris.control", async (msg) => {
    return { ok: true, action: String(msg.action || ""), stub: true };
  });

  function update(payload) {
    payload = payload || {};
    const wire = {
      title: payload.title || "",
      artist: payload.artist || "",
      album: payload.album || "",
      playback_status: payload.state || payload.playback_status || "none",
      position_us: typeof payload.position === "number"
        ? Math.floor(payload.position * 1000000)
        : (typeof payload.position_us === "number" ? payload.position_us : 0),
      tab_id: typeof payload.tab_id === "number" ? payload.tab_id : null,
    };
    return dispatcher.request("mpris.publish", wire);
  }

  root.qdistroMpris = { update };
})(typeof self !== "undefined" ? self : globalThis);
