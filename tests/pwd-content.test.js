/** @vitest-environment jsdom */
// pwd-content.js — autofill content script. SECURITY CONTRACT
// (finding #10): credential delivery requires a TRUSTED user gesture
// (a real click/keydown, event.isTrusted === true). A synthetic /
// programmatic focus or click from page script must NOT cause any
// secret-bearing fill. On a trusted gesture the script asks the
// background for credentials and renders a confirmation picker; it
// never silently auto-fills, not even for a single match. A
// credential only reaches the page DOM after the user clicks a
// picker row (another trusted gesture). On form submit it reports
// pwd.request_save only if the password actually changed.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "..", "src", "content", "pwd-content.js"),
  "utf8",
);

function makeBrowser() {
  const sent = [];
  let fillReply = { ok: true, response: { credentials: [] } };
  return {
    sent,
    setFillReply(r) { fillReply = r; },
    browser: {
      runtime: {
        sendMessage(msg) {
          sent.push(msg);
          if (msg.kind === "pwd.request_fill") return Promise.resolve(fillReply);
          // pwd.request_save is fire-and-forget; .catch handles failure.
          return Promise.resolve({ ok: true });
        },
      },
    },
  };
}

// Each test loads the IIFE fresh, but document persists across tests
// in the same file. Track addEventListener calls during load so
// afterEach can detach them — otherwise stale handlers from previous
// tests fire against the new DOM with the wrong mock state.
const tracked = []; // {target, type, wrapped, options}

// jsdom marks Event.isTrusted as a non-configurable, read-only own
// property (always false for dispatched events), so we cannot force
// it on an event instance. Instead we wrap every listener the content
// script registers and hand it a Proxy of the event whose isTrusted
// reflects a per-dispatch flag — faithfully exercising the trust
// check in pwd-content.js without touching production code.
let forcedTrust = false;
let origAddEventListener = null;

function installTrustWrapper() {
  origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const wrapped = function (e) {
      const proxied = new Proxy(e, {
        get(t, prop) {
          if (prop === "isTrusted") return forcedTrust;
          const v = t[prop];
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
      return listener.call(this, proxied);
    };
    tracked.push({ target: this, type, wrapped, options });
    return origAddEventListener.call(this, type, wrapped, options);
  };
}

function uninstallTrustWrapper() {
  if (origAddEventListener) {
    EventTarget.prototype.addEventListener = origAddEventListener;
    origAddEventListener = null;
  }
}

function load(env) {
  globalThis.browser = env.browser;
  // eslint-disable-next-line no-new-func
  new Function(SRC)();
}

function detachTrackedListeners() {
  while (tracked.length) {
    const { target, type, wrapped, options } = tracked.pop();
    try { target.removeEventListener(type, wrapped, options); } catch (_) {}
  }
}

// Dispatch an event with the per-dispatch trust flag set; listeners
// wrapped by installTrustWrapper observe event.isTrusted === `trusted`.
function dispatchAs(target, event, trusted) {
  const prev = forcedTrust;
  forcedTrust = trusted;
  try {
    return target.dispatchEvent(event);
  } finally {
    forcedTrust = prev;
  }
}

// A genuine user click on the password field.
function userClick(el) {
  return dispatchAs(el, new MouseEvent("click", { bubbles: true }), true);
}

// A genuine user keystroke into a field (trusted keydown). Used to
// prove that ordinary typing produces NO fill request (finding #10
// follow-up: keydown must not trigger a fill).
function userType(el, key) {
  return dispatchAs(el, new KeyboardEvent("keydown", { key, bubbles: true }), true);
}

// A genuine form submission (trusted submit event), as the browser
// delivers it for a real button click / Enter keypress.
function trustedSubmit(form) {
  return dispatchAs(form, new Event("submit", { bubbles: true, cancelable: true }), true);
}

function buildLoginForm({ username = "", password = "" } = {}) {
  document.body.innerHTML = `
    <form id="login">
      <input id="u" type="text" name="user" value="${username}">
      <input id="p" type="password" name="pass" value="${password}">
      <button type="submit">go</button>
    </form>
  `;
  return {
    form: document.getElementById("login"),
    u: document.getElementById("u"),
    p: document.getElementById("p"),
  };
}

async function tick() {
  // Two microtask drains: sendMessage's Promise → fill callback.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("pwd-content.js", () => {
  let env;

  beforeEach(() => { env = makeBrowser(); forcedTrust = false; installTrustWrapper(); });
  afterEach(() => {
    uninstallTrustWrapper();
    detachTrackedListeners();
    delete globalThis.browser;
    document.body.innerHTML = "";
  });

  it("a TRUSTED user click on the password field fires pwd.request_fill with the page URL", async () => {
    const { p } = buildLoginForm();
    load(env);
    userClick(p);
    await tick();
    const frame = env.sent.find((m) => m.kind === "pwd.request_fill");
    expect(frame).toBeTruthy();
    expect(frame.url).toBe(location.href);
  });

  it("a SYNTHETIC (untrusted) focus does NOT request credentials (finding #10)", async () => {
    env.setFillReply({
      ok: true,
      response: { credentials: [{ username: "alice", password: "s3cret" }] },
    });
    const { u, p } = buildLoginForm();
    load(env);
    p.dispatchEvent(new FocusEvent("focus"));
    p.dispatchEvent(new MouseEvent("click", { bubbles: true })); // isTrusted=false
    await tick();
    expect(env.sent.find((m) => m.kind === "pwd.request_fill")).toBeUndefined();
    expect(p.value).toBe("");
    expect(u.value).toBe("");
    expect(document.getElementById("qdistro-pwd-picker")).toBeNull();
  });

  it("a trusted click on a non-password input does NOT fire request_fill", async () => {
    buildLoginForm();
    document.body.innerHTML = `<input id="lonely" type="text">`;
    load(env);
    userClick(document.getElementById("lonely"));
    await tick();
    expect(env.sent.find((m) => m.kind === "pwd.request_fill"))
      .toBeUndefined();
  });

  it("single-credential reply renders a confirmation picker and does NOT auto-fill (finding #10)", async () => {
    env.setFillReply({
      ok: true,
      response: {
        credentials: [{ username: "alice", password: "s3cret" }],
      },
    });
    const { u, p } = buildLoginForm();
    load(env);
    userClick(p);
    await tick();
    expect(p.value).toBe("");
    expect(u.value).toBe("");
    const picker = document.getElementById("qdistro-pwd-picker");
    expect(picker).toBeTruthy();
    expect(picker.children).toHaveLength(1);
    expect(picker.children[0].textContent).toBe("alice");
  });

  it("a TRUSTED picker-row click fills, and dispatches input/change events", async () => {
    env.setFillReply({
      ok: true,
      response: { credentials: [{ username: "alice", password: "s3cret" }] },
    });
    const { u, p } = buildLoginForm();
    const events = [];
    for (const el of [u, p]) {
      for (const ev of ["input", "change"]) {
        el.addEventListener(ev, () => events.push(`${el.id}:${ev}`));
      }
    }
    load(env);
    userClick(p);
    await tick();
    const picker = document.getElementById("qdistro-pwd-picker");
    expect(picker).toBeTruthy();
    dispatchAs(picker.children[0],
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }), true);
    expect(p.value).toBe("s3cret");
    expect(u.value).toBe("alice");
    expect(events).toContain("u:input");
    expect(events).toContain("u:change");
    expect(events).toContain("p:input");
    expect(events).toContain("p:change");
  });

  it("an UNTRUSTED picker-row mousedown does NOT fill (finding #10)", async () => {
    env.setFillReply({
      ok: true,
      response: { credentials: [{ username: "alice", password: "s3cret" }] },
    });
    const { u, p } = buildLoginForm();
    load(env);
    userClick(p);
    await tick();
    const picker = document.getElementById("qdistro-pwd-picker");
    expect(picker).toBeTruthy();
    picker.children[0].dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })); // untrusted
    expect(p.value).toBe("");
    expect(u.value).toBe("");
  });

  it("multi-credential reply renders the picker overlay; trusted click fills", async () => {
    env.setFillReply({
      ok: true,
      response: {
        credentials: [
          { username: "alice", password: "p1" },
          { username: "bob",   password: "p2" },
        ],
      },
    });
    const { u, p } = buildLoginForm();
    load(env);
    userClick(p);
    await tick();
    const picker = document.getElementById("qdistro-pwd-picker");
    expect(picker).toBeTruthy();
    expect(picker.children).toHaveLength(2);
    expect(picker.children[0].textContent).toBe("alice");
    expect(picker.children[1].textContent).toBe("bob");

    // Trusted click on the second row.
    dispatchAs(picker.children[1],
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }), true);
    expect(p.value).toBe("p2");
    expect(u.value).toBe("bob");
    // Picker is removed after a pick.
    expect(document.getElementById("qdistro-pwd-picker")).toBeNull();
  });

  it("empty credentials list does not fill or render a picker", async () => {
    env.setFillReply({ ok: true, response: { credentials: [] } });
    const { p } = buildLoginForm({ password: "" });
    load(env);
    userClick(p);
    await tick();
    expect(p.value).toBe("");
    expect(document.getElementById("qdistro-pwd-picker")).toBeNull();
  });

  it("ok:false reply does not fill or render a picker", async () => {
    env.setFillReply({ ok: false, error: "policy_denied" });
    const { p } = buildLoginForm();
    load(env);
    userClick(p);
    await tick();
    expect(p.value).toBe("");
    expect(document.getElementById("qdistro-pwd-picker")).toBeNull();
  });

  it("form submit after a confirmed fill does NOT fire pwd.request_save when value is unchanged", async () => {
    env.setFillReply({
      ok: true,
      response: { credentials: [{ username: "alice", password: "p1" }] },
    });
    const { form, p } = buildLoginForm();
    load(env);
    userClick(p);
    await tick();
    const picker = document.getElementById("qdistro-pwd-picker");
    dispatchAs(picker.children[0],
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }), true);
    expect(p.value).toBe("p1");
    const beforeLen = env.sent.length;
    trustedSubmit(form);
    await tick();
    expect(env.sent.slice(beforeLen).find((m) => m.kind === "pwd.request_save"))
      .toBeUndefined();
  });

  it("form submit after a manual edit fires pwd.request_save", async () => {
    const { form, u, p } = buildLoginForm();
    load(env);
    // User types credentials by hand (no fill happened).
    p.value = "p1-typed";
    u.value = "alice-edited";
    trustedSubmit(form);
    await tick();
    const saveFrame = env.sent.find((m) => m.kind === "pwd.request_save");
    expect(saveFrame).toBeTruthy();
    expect(saveFrame.password).toBe("p1-typed");
    expect(saveFrame.username).toBe("alice-edited");
    expect(saveFrame.url).toBe(location.href);
  });

  it("form submit without any prior fill always reports request_save", async () => {
    const { form, p } = buildLoginForm({ username: "carol", password: "manual-pw" });
    load(env);
    trustedSubmit(form);
    await tick();
    const saveFrame = env.sent.find((m) => m.kind === "pwd.request_save");
    expect(saveFrame).toBeTruthy();
    expect(saveFrame.password).toBe("manual-pw");
    // form value was kept; submit reads current value.
    expect(p.value).toBe("manual-pw");
  });

  it("form submit with an empty password input does NOT fire request_save", async () => {
    const { form } = buildLoginForm({ password: "" });
    load(env);
    trustedSubmit(form);
    await tick();
    expect(env.sent.find((m) => m.kind === "pwd.request_save"))
      .toBeUndefined();
  });

  // --- Problem 1 regression: normal typing must NOT request a fill ---
  it("typing a password (trusted keydown burst) produces ZERO pwd.request_fill", async () => {
    env.setFillReply({
      ok: true,
      response: { credentials: [{ username: "alice", password: "s3cret" }] },
    });
    const { u, p } = buildLoginForm();
    load(env);
    // Focus then type a whole password. Under the old code each
    // keydown fired a fresh pwd.request_fill and re-rendered the
    // picker over the field being typed into.
    p.focus();
    for (const ch of "hunter2!") userType(p, ch);
    // Reflect what real typing does to the field's value.
    p.value = "hunter2!";
    await tick();
    expect(env.sent.find((m) => m.kind === "pwd.request_fill")).toBeUndefined();
    expect(document.getElementById("qdistro-pwd-picker")).toBeNull();
    expect(u.value).toBe("");
  });

  it("a trusted click on an ALREADY-NON-EMPTY password field does NOT re-request a fill", async () => {
    env.setFillReply({
      ok: true,
      response: { credentials: [{ username: "alice", password: "s3cret" }] },
    });
    const { p } = buildLoginForm({ password: "typed-already" });
    load(env);
    userClick(p);
    await tick();
    // The field already holds text the user typed; never anchor a
    // picker over it or request credentials.
    expect(env.sent.find((m) => m.kind === "pwd.request_fill")).toBeUndefined();
    expect(document.getElementById("qdistro-pwd-picker")).toBeNull();
  });

  it("a second trusted click while the picker is open does NOT re-request a fill", async () => {
    env.setFillReply({
      ok: true,
      response: { credentials: [{ username: "alice", password: "s3cret" }] },
    });
    const { p } = buildLoginForm();
    load(env);
    userClick(p);
    await tick();
    expect(document.getElementById("qdistro-pwd-picker")).toBeTruthy();
    const afterFirst = env.sent.filter((m) => m.kind === "pwd.request_fill").length;
    expect(afterFirst).toBe(1);
    // Click again while the picker is still open: no new request.
    userClick(p);
    await tick();
    expect(env.sent.filter((m) => m.kind === "pwd.request_fill").length)
      .toBe(afterFirst);
  });

  // --- Problem 2 regression: a synthetic submit must NOT offer save ---
  it("a SYNTHETIC (untrusted) submit does NOT fire pwd.request_save (finding #10)", async () => {
    // A malicious page sets attacker-chosen creds and dispatches a
    // scripted submit. Honoring it would poison the credential store
    // for the real origin.
    const { form, u, p } = buildLoginForm();
    load(env);
    u.value = "attacker";
    p.value = "evil-pw";
    // Untrusted: plain dispatchEvent (isTrusted=false via the wrapper).
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(env.sent.find((m) => m.kind === "pwd.request_save")).toBeUndefined();
    // And a real (trusted) submit of the same form still works.
    trustedSubmit(form);
    await tick();
    expect(env.sent.find((m) => m.kind === "pwd.request_save")).toBeTruthy();
  });
});
