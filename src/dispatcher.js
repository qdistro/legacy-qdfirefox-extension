// request_id-correlated dispatcher.
//
// Two flows:
//
//   1. Bridge-initiated request (daemon → bridge → extension):
//      bridge sends `{op: "tabs.list", request_id: "rN-hex"}` over
//      the port. request_id is a string (e.g. "r1-abc123"); the
//      dispatcher accepts any truthy value (`!= null`).
//      Dispatcher routes by op to a registered handler in
//      src/modules/, awaits the handler's reply payload, then sends
//      `{op: "tabs.list.reply", request_id: "rN-hex", ...payload}` back.
//
//   2. Extension-initiated request (popup click → extension → bridge → daemon):
//      caller invokes `qdistroDispatcher.request("cookies.export", body)`
//      which assigns a request_id and returns a Promise. The dispatcher
//      keeps a Map<request_id, {resolve,reject,timer}> until a matching
//      `.reply` arrives.
//
// Shape matches qdchrome-extension exactly — same wire protocol, so
// the same bridge implementation drives both browsers.
//
// @ts-check
(function (root) {
  "use strict";
  const port = root.qdistroPort;
  const DEFAULT_TIMEOUT_MS = 10000;

  const handlers = new Map();
  const pending = new Map();
  let nextRequestId = 1;

  function log(...args) {
    try { console.log("[qdistro/dispatch]", ...args); } catch (_) { /* event page */ }
  }

  function register(op, handler) {
    if (handlers.has(op)) {
      log(`overwriting handler for ${op}`);
    }
    handlers.set(op, handler);
  }

  async function handleInbound(msg) {
    if (!msg || typeof msg !== "object") return;
    const op = String(msg.op || "");
    if (!op) return;

    if (op.endsWith(".reply") && msg.request_id != null) {
      const slot = pending.get(msg.request_id);
      if (!slot) {
        log("orphan reply", op, msg.request_id);
        return;
      }
      pending.delete(msg.request_id);
      if (slot.timer) clearTimeout(slot.timer);
      slot.resolve(msg);
      return;
    }

    const h = handlers.get(op);
    if (!h) {
      log("no handler for inbound op", op);
      if (msg.request_id != null) {
        port.send({
          op: `${op}.reply`,
          request_id: msg.request_id,
          ok: false,
          error: "unknown_op",
        });
      }
      return;
    }
    try {
      const body = (await h(msg)) || {};
      if (msg.request_id != null) {
        port.send({
          op: `${op}.reply`,
          request_id: msg.request_id,
          ok: true,
          ...body,
        });
      }
    } catch (e) {
      log("handler threw", op, e);
      if (msg.request_id != null) {
        port.send({
          op: `${op}.reply`,
          request_id: msg.request_id,
          ok: false,
          error: "handler_raised",
          detail: String(e).slice(0, 200),
        });
      }
    }
  }

  function request(op, body, opts) {
    opts = opts || {};
    const request_id = nextRequestId++;
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(request_id)) {
          pending.delete(request_id);
          reject(new Error(`timeout: ${op}`));
        }
      }, timeoutMs);
      pending.set(request_id, { resolve, reject, timer, op });
      const sent = port.send({ op, request_id, ...(body || {}) });
      if (!sent) {
        clearTimeout(timer);
        pending.delete(request_id);
        reject(new Error("port_disconnected"));
      }
    });
  }

  function _resetForTests() {
    for (const slot of pending.values()) {
      if (slot.timer) clearTimeout(slot.timer);
    }
    pending.clear();
    handlers.clear();
    nextRequestId = 1;
  }

  port.onMessage(handleInbound);

  root.qdistroDispatcher = {
    register,
    request,
    handlers,
    pending,
    handleInbound,
    _resetForTests,
  };
})(typeof self !== "undefined" ? self : globalThis);
