// Test helpers — load the extension's source files into a synthetic
// `self` global so the IIFE modules attach their exports there.
//
// Vanilla JS modules use the `self` global of an event page. In Node
// we synthesize the same shape and eval each source into a fresh
// scope per call — cheap, no jsdom dependency, no transpiler.
//
// Difference from qdchrome-extension/tests/helpers.js: the fake
// `browser` returns Promises from API methods (the Firefox-native
// shape), because src/api.js binds to `browser` and modules `await`
// the results directly.
//
// @ts-check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..", "src");

export function makeFakePort() {
  const listeners = { msg: [], dc: [] };
  const sent = [];
  const port = {
    error: null,
    postMessage: (m) => { sent.push(m); },
    disconnect: () => {
      for (const cb of listeners.dc) cb();
    },
    onMessage: { addListener: (cb) => listeners.msg.push(cb) },
    onDisconnect: { addListener: (cb) => listeners.dc.push(cb) },
  };
  return {
    port, sent,
    deliver: (msg) => { for (const cb of listeners.msg) cb(msg); },
    triggerDisconnect: () => { for (const cb of listeners.dc) cb(); },
  };
}

function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (cb) => { listeners.push(cb); },
    fire: (...args) => { for (const cb of listeners) cb(...args); },
  };
}

export function makeFakeBrowser(overrides = {}) {
  const fakes = {
    runtime: {
      id: "test-ext-id",
      lastError: null,
      connectNative: () => { throw new Error("override connectNative"); },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
    tabs: {
      query: (_q) => Promise.resolve([]),
      create: (p) => Promise.resolve({ id: 99, ...p }),
      remove: (_ids) => Promise.resolve(),
    },
    cookies: {
      getAll: (_q) => Promise.resolve([]),
    },
    downloads: {
      onChanged: makeEvent(),
      search: (_q) => Promise.resolve([]),
    },
    notifications: {
      onClicked: makeEvent(),
      onClosed: makeEvent(),
      create: (_id, _opts) => Promise.resolve("notif-1"),
    },
    contextMenus: {
      create: (_def) => {},
      onClicked: makeEvent(),
    },
    contextualIdentities: {
      query: (_q) => Promise.resolve([]),
      create: (props) => Promise.resolve({
        cookieStoreId: "firefox-container-99",
        name: props.name, color: props.color,
        colorCode: "#37adff", icon: props.icon, iconUrl: "",
      }),
      remove: (id) => Promise.resolve({
        cookieStoreId: id, name: "removed", color: "",
        colorCode: "", icon: "", iconUrl: "",
      }),
    },
    storage: {
      local: {
        get: (_k) => Promise.resolve({}),
        set: (_v) => Promise.resolve(),
      },
    },
    scripting: {
      executeScript: () => Promise.resolve([{ result: {} }]),
    },
  };
  return Object.assign(fakes, overrides);
}

export { makeEvent };

/**
 * Load the extension source into a fresh global scope and return it.
 * Each call yields an independent `self` so tests don't bleed.
 */
export function loadExtension(opts = {}) {
  const fakeBrowser = opts.browser || makeFakeBrowser();
  const fakePortHandle = opts.portHandle || makeFakePort();
  fakeBrowser.runtime.connectNative = () => fakePortHandle.port;

  const scope = {};
  scope.self = scope;
  scope.console = console;
  scope.browser = fakeBrowser;
  scope.setTimeout = setTimeout;
  scope.clearTimeout = clearTimeout;
  scope.setInterval = setInterval;
  scope.clearInterval = clearInterval;
  scope.Date = Date;
  scope.Math = Math;
  scope.JSON = JSON;
  scope.Promise = Promise;
  scope.Error = Error;
  scope.Array = Array;
  scope.Object = Object;
  scope.String = String;
  scope.Number = Number;
  scope.Boolean = Boolean;
  scope.Map = Map;
  scope.Set = Set;
  scope.Symbol = Symbol;

  function evalFile(rel) {
    const code = fs.readFileSync(path.join(SRC, rel), "utf8");
    // Each source is an IIFE bound to `self`. We pass `browser` as
    // an extra param so the api.js `typeof browser !== "undefined"`
    // check sees the synthetic object.
    const wrapped =
      `(function(self, browser, console){\n${code}\n}).call(__scope__, __scope__, __scope__.browser, __scope__.console)`;
    const fn = new Function("__scope__", `return ${wrapped};`);
    fn(scope);
  }

  evalFile("api.js");
  evalFile("port.js");
  evalFile("dispatcher.js");
  evalFile("intent.js");
  evalFile("modules/tabs.js");
  evalFile("modules/pwd.js");
  evalFile("modules/pageExtract.js");
  evalFile("modules/cookies.js");
  evalFile("modules/containers.js");
  evalFile("modules/mpris.js");
  evalFile("modules/downloads.js");
  evalFile("modules/notifications.js");
  evalFile("modules/screenlock.js");

  return { scope, port: fakePortHandle };
}
