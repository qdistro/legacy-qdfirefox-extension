/** @vitest-environment jsdom */
// pwd-content.js — autofill content script. On password-input focus
// asks the background for credentials; fills one match directly,
// renders a picker for multiple, swallows none. On form submit
// reports pwd.request_save only if the password actually changed.
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
const tracked = []; // {target, type, listener, options}

function load(env) {
  globalThis.browser = env.browser;
  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    tracked.push({ target: this, type, listener, options });
    return origAdd.call(this, type, listener, options);
  };
  try {
    // eslint-disable-next-line no-new-func
    new Function(SRC)();
  } finally {
    EventTarget.prototype.addEventListener = origAdd;
  }
}

function detachTrackedListeners() {
  while (tracked.length) {
    const { target, type, listener, options } = tracked.pop();
    try { target.removeEventListener(type, listener, options); } catch (_) {}
  }
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

  beforeEach(() => { env = makeBrowser(); });
  afterEach(() => {
    detachTrackedListeners();
    delete globalThis.browser;
    document.body.innerHTML = "";
  });

  it("password input focus fires pwd.request_fill with the page URL", async () => {
    const { p } = buildLoginForm();
    load(env);
    p.dispatchEvent(new FocusEvent("focus"));
    await tick();
    const frame = env.sent.find((m) => m.kind === "pwd.request_fill");
    expect(frame).toBeTruthy();
    expect(frame.url).toBe(location.href);
  });

  it("focus on a non-password input does NOT fire request_fill", async () => {
    const { u } = buildLoginForm();
    load(env);
    u.dispatchEvent(new FocusEvent("focus"));
    await tick();
    expect(env.sent.find((m) => m.kind === "pwd.request_fill"))
      .toBeUndefined();
  });

  it("single-credential reply auto-fills both username and password", async () => {
    env.setFillReply({
      ok: true,
      response: {
        credentials: [{ username: "alice", password: "s3cret" }],
      },
    });
    const { u, p } = buildLoginForm();
    load(env);
    p.dispatchEvent(new FocusEvent("focus"));
    await tick();
    expect(p.value).toBe("s3cret");
    expect(u.value).toBe("alice");
  });

  it("dispatches input/change events on the filled inputs", async () => {
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
    p.dispatchEvent(new FocusEvent("focus"));
    await tick();
    expect(events).toContain("u:input");
    expect(events).toContain("u:change");
    expect(events).toContain("p:input");
    expect(events).toContain("p:change");
  });

  it("multi-credential reply renders the picker overlay; click fills", async () => {
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
    p.dispatchEvent(new FocusEvent("focus"));
    await tick();
    const picker = document.getElementById("qdistro-pwd-picker");
    expect(picker).toBeTruthy();
    expect(picker.children).toHaveLength(2);
    expect(picker.children[0].textContent).toBe("alice");
    expect(picker.children[1].textContent).toBe("bob");

    // Click the second row.
    picker.children[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(p.value).toBe("p2");
    expect(u.value).toBe("bob");
    // Picker is removed after a pick.
    expect(document.getElementById("qdistro-pwd-picker")).toBeNull();
  });

  it("empty credentials list does not fill or render a picker", async () => {
    env.setFillReply({ ok: true, response: { credentials: [] } });
    const { p } = buildLoginForm({ password: "" });
    load(env);
    p.dispatchEvent(new FocusEvent("focus"));
    await tick();
    expect(p.value).toBe("");
    expect(document.getElementById("qdistro-pwd-picker")).toBeNull();
  });

  it("ok:false reply does not fill or render a picker", async () => {
    env.setFillReply({ ok: false, error: "policy_denied" });
    const { p } = buildLoginForm();
    load(env);
    p.dispatchEvent(new FocusEvent("focus"));
    await tick();
    expect(p.value).toBe("");
    expect(document.getElementById("qdistro-pwd-picker")).toBeNull();
  });

  it("form submit after a fill does NOT fire pwd.request_save when value is unchanged", async () => {
    env.setFillReply({
      ok: true,
      response: { credentials: [{ username: "alice", password: "p1" }] },
    });
    const { form, p } = buildLoginForm();
    load(env);
    p.dispatchEvent(new FocusEvent("focus"));
    await tick();
    const beforeLen = env.sent.length;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(env.sent.slice(beforeLen).find((m) => m.kind === "pwd.request_save"))
      .toBeUndefined();
  });

  it("form submit after a manual edit fires pwd.request_save", async () => {
    env.setFillReply({
      ok: true,
      response: { credentials: [{ username: "alice", password: "p1" }] },
    });
    const { form, u, p } = buildLoginForm();
    load(env);
    p.dispatchEvent(new FocusEvent("focus"));
    await tick();
    // User retypes the password — different from what we filled.
    p.value = "p1-typed";
    u.value = "alice-edited";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
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
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
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
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(env.sent.find((m) => m.kind === "pwd.request_save"))
      .toBeUndefined();
  });
});
