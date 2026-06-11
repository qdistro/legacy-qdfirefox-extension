// Cross-repo bridge-protocol contract test (Firefox side).
//
// Consumes the shared golden frames (tests/fixtures/golden-frames.js,
// kept byte-identical with the Chromium repo) and drives them against
// the REAL dispatcher handlers and module functions — not stubs:
//
//   - INBOUND frames are fed through dispatcher.handleInbound() and the
//     emitted `<op>.reply` is validated.
//   - OUTBOUND frames are produced by calling the actual module
//     functions and the frame put on the port is validated.
//
// Difference from the Chromium copy: the fake `browser.*` API returns
// Promises (the Firefox-native shape), so the env wiring uses
// Promise-resolving stubs instead of callback stubs. The golden frames
// themselves are identical — that is the whole point of the contract.
//
// ensures: this extension's handlers accept the canonical request
// frames and produce the canonical reply/outbound frames the bridge —
// and the sibling Chromium extension — agree on. Drift on either side
// (a renamed field, a dropped reply key) fails here.
import { describe, it, expect, beforeEach } from "vitest";
import { loadExtension, makeFakeBrowser, makeFakePort } from "./helpers.js";
import { INBOUND, OUTBOUND } from "./fixtures/golden-frames.js";

describe("bridge protocol contract — INBOUND (bridge → extension)", () => {
  let env;
  let browser;
  beforeEach(() => {
    browser = makeFakeBrowser();
    browser.tabs.create = (p) => Promise.resolve({ id: 99, url: p.url, active: !!p.active, title: "t" });
    browser.tabs.query = (_q) => Promise.resolve([{ id: 1, url: "https://a/", title: "A", active: true }]);
    browser.tabs.remove = (_ids) => Promise.resolve();
    env = loadExtension({ browser, portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
    env.scope.qdistroNotifications.install();
  });

  function replyFor(op) {
    return env.port.sent.find((m) => m.op === op);
  }

  for (const f of INBOUND) {
    it(`accepts ${f.name} and replies with ${f.replyOp}`, async () => {
      await env.scope.qdistroDispatcher.handleInbound(f.request);
      const reply = replyFor(f.replyOp);
      expect(reply, `no ${f.replyOp} emitted`).toBeTruthy();
      expect(reply.request_id).toBe(f.request.request_id);
      if (f.replyMatch) expect(reply).toMatchObject(f.replyMatch);
      for (const k of f.replyKeys || []) {
        expect(reply, `reply missing key ${k}`).toHaveProperty(k);
      }
    });
  }
});

describe("bridge protocol contract — OUTBOUND (extension → bridge)", () => {
  let env;
  let browser;
  beforeEach(() => {
    browser = makeFakeBrowser();
    browser.downloads.search = (_q) => Promise.resolve([{
      id: 11, url: "https://x/a.zip", filename: "/tmp/a.zip",
      state: "in_progress", totalBytes: 4096, bytesReceived: 512,
    }]);
    browser.cookies.getAll = (_q) => Promise.resolve([
      { name: "sid", value: "v", domain: ".example.com", path: "/", secure: true },
    ]);
    env = loadExtension({ browser, portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
  });

  function sentFor(op) {
    return env.port.sent.find((m) => m.op === op);
  }

  async function produce(f) {
    if (f.op_via === "downloads") {
      env.scope.qdistroDownloads.install();
      browser.downloads.onChanged.fire({ id: 11, state: { current: "in_progress" } });
    } else if (f.op_via === "cookies") {
      const token = await env.scope.qdistroIntent.mint("cookies.export");
      void env.scope.qdistroCookies.exportForUrl("https://example.com/", token);
    } else {
      f.produce(env);
    }
    // Firefox paths chain through Promise-returning APIs; poll a couple
    // of microtask ticks so the await-chain lands the frame.
    for (let i = 0; i < 5; i++) {
      if (sentFor(f.op)) break;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  for (const f of OUTBOUND) {
    it(`produces a canonical ${f.name} frame`, async () => {
      await produce(f);
      const frame = sentFor(f.op);
      expect(frame, `no ${f.op} frame produced`).toBeTruthy();
      expect(frame).toMatchObject(f.match);
      for (const k of f.keys || []) {
        expect(frame, `frame missing key ${k}`).toHaveProperty(k);
      }
    });
  }
});
