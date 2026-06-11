// Golden request/reply frames for the qdistro bridge protocol.
//
// ============================ KEEP IN SYNC ============================
// This file is duplicated VERBATIM in the sibling extension repo:
//
//     qdchrome-extension/tests/fixtures/golden-frames.js
//     qdfirefox-extension/tests/fixtures/golden-frames.js
//
// There is no npm workspace linking the two repos, so the copies must
// be kept byte-identical by hand. Both extensions speak the SAME wire
// protocol to the native host (the bridge does not care which browser
// it is talking to), so a frame that one extension accepts/produces
// the other must too. If you edit one copy, edit the other and re-run
// `npm test` in BOTH repos.
// =====================================================================
//
// Two frame directions:
//
//   inbound  — the bridge SENDS this to the extension (a request with a
//              request_id). The extension's dispatcher routes it to a
//              registered handler and SENDS BACK `<op>.reply`. Each
//              entry pins the request frame and the shape the reply
//              must satisfy.
//
//   outbound — the extension PRODUCES this (a module function called by
//              the popup / a content script / an event listener). Each
//              entry pins the op and the fields the produced frame must
//              carry. The bridge is the consumer.
//
// The contract test (tests/contract.test.js) drives the REAL handlers
// and module functions against these frames — they are not stubs.
//
// @ts-check

// Canonical INBOUND requests (bridge → extension) and the assertions
// the resulting `<op>.reply` must satisfy. `replyMatch` is a partial
// object the reply must matchObject; `replyKeys` lists keys that must
// be present (value-agnostic, for env-dependent values like ids).
export const INBOUND = [
  {
    name: "tabs.list",
    request: { op: "tabs.list", request_id: "r-tabs-1" },
    replyOp: "tabs.list.reply",
    replyMatch: { ok: true },
    replyKeys: ["tabs"],
  },
  {
    name: "tabs.open",
    request: { op: "tabs.open", request_id: "r-tabs-2", url: "https://example.com/", active: true },
    replyOp: "tabs.open.reply",
    replyMatch: { ok: true },
    replyKeys: ["tab"],
  },
  {
    name: "tabs.close",
    request: { op: "tabs.close", request_id: "r-tabs-3", tab_ids: [1, 2] },
    replyOp: "tabs.close.reply",
    replyMatch: { ok: true, closed: [1, 2] },
  },
  {
    name: "tabs.open missing url is a deterministic error",
    request: { op: "tabs.open", request_id: "r-tabs-4" },
    replyOp: "tabs.open.reply",
    // Handler returns {ok:false,...}; dispatcher wraps with ok:true and
    // spreads the body, so the body's ok:false wins.
    replyMatch: { ok: false, error: "missing_url" },
  },
  {
    name: "notifications.show",
    request: {
      op: "notifications.show", request_id: "r-notif-1",
      title: "Build done", message: "qci is green", icon_url: "icons/icon-48.png",
    },
    replyOp: "notifications.show.reply",
    replyMatch: { ok: true },
    replyKeys: ["notification_id"],
  },
  {
    name: "mpris.control with no target tab is a deterministic error",
    request: { op: "mpris.control", request_id: "r-mpris-1", action: "play" },
    replyOp: "mpris.control.reply",
    replyMatch: { ok: false, action: "play", error: "no_target_tab" },
  },
  {
    name: "an unknown op is rejected, not dispatched",
    request: { op: "totally.bogus", request_id: "r-bogus-1" },
    replyOp: "totally.bogus.reply",
    replyMatch: { ok: false, error: "unknown_op" },
  },
];

// Canonical OUTBOUND frames (extension → bridge). `produce` is invoked
// by the contract test with the loaded env; it must trigger the module
// and return the op string to look for. `match` is a partial object the
// produced frame must matchObject; `keys` lists keys that must exist.
export const OUTBOUND = [
  {
    name: "screenlock.inhibit",
    op: "screenlock.inhibit",
    produce: (env) => { void env.scope.qdistroScreenlock.inhibit("fullscreen_video"); },
    match: { op: "screenlock.inhibit", reason: "fullscreen_video" },
    keys: ["request_id"],
  },
  {
    name: "screenlock.release",
    op: "screenlock.release",
    produce: (env) => { void env.scope.qdistroScreenlock.release("fullscreen_exit"); },
    match: { op: "screenlock.release", reason: "fullscreen_exit" },
    keys: ["request_id"],
  },
  {
    name: "mpris.publish",
    op: "mpris.publish",
    produce: (env) => {
      void env.scope.qdistroMpris.update({
        title: "Song", artist: "Artist", album: "Album",
        state: "playing", position: 1.5, tab_id: 7,
      });
    },
    match: {
      op: "mpris.publish", title: "Song", artist: "Artist", album: "Album",
      playback_status: "playing", position_us: 1500000, tab_id: 7,
    },
    keys: ["request_id"],
  },
  {
    name: "pwd.fill",
    op: "pwd.fill",
    produce: (env) => {
      void env.scope.qdistroPwd.fill("https://example.com/login", "alice", {
        operation: "pwd.fill", nonce: "gf-1",
      });
    },
    match: {
      op: "pwd.fill", url: "https://example.com/login", username: "alice",
    },
    keys: ["request_id", "intent_token"],
  },
  {
    name: "pwd.save",
    op: "pwd.save",
    produce: (env) => {
      void env.scope.qdistroPwd.save("https://example.com/signup", "bob", "hunter2", {
        operation: "pwd.save", nonce: "gf-2",
      });
    },
    match: {
      op: "pwd.save", url: "https://example.com/signup",
      username: "bob", password: "hunter2",
    },
    keys: ["request_id", "intent_token"],
  },
  {
    name: "downloads.notify",
    op: "downloads.notify",
    // Driven via the module's snapshot → dispatcher.request path. The
    // contract test resolves the item through the fake search.
    op_via: "downloads",
    match: { op: "downloads.notify", state: "in_progress" },
    keys: ["request_id", "download_id"],
  },
  {
    name: "cookies.export",
    op: "cookies.export",
    op_via: "cookies",
    match: { op: "cookies.export", url: "https://example.com/" },
    keys: ["request_id", "intent_token", "cookies"],
  },
];
