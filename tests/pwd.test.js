// pwd module — extension-initiated only.
//
// fill() and save() return Promises that resolve when the bridge
// replies. Tests must deliver a reply (or detach with .catch) — an
// un-resolved Promise leaks into the dispatcher's pending Map and
// will emit an unhandled-rejection after the 10s default timeout.
import { describe, it, expect, beforeEach } from "vitest";
import { loadExtension } from "./helpers.js";

describe("qdistroPwd", () => {
  let env;
  beforeEach(() => {
    env = loadExtension();
    env.scope.qdistroPort.connect();
  });

  function replyTo(op, body) {
    const req = env.port.sent.find((m) => m.op === op);
    expect(req).toBeTruthy();
    env.port.deliver({
      op: `${op}.reply`,
      request_id: req.request_id,
      ok: true,
      ...(body || {}),
    });
    return req;
  }

  it("fill() sends pwd.fill with intent token", async () => {
    const p = env.scope.qdistroPwd.fill("https://example.com/", "alice", { nonce: "n1" });
    const req = replyTo("pwd.fill", { credentials: [] });
    expect(req).toMatchObject({
      url: "https://example.com/",
      username: "alice",
      intent_token: { nonce: "n1" },
    });
    await p;
  });

  it("fill() coerces a missing username to null", async () => {
    const p = env.scope.qdistroPwd.fill("https://example.com/", null, { nonce: "n2" });
    const req = replyTo("pwd.fill", { credentials: [] });
    expect(req.username).toBeNull();
    await p;
  });

  it("save() sends pwd.save with all credential fields", async () => {
    const p = env.scope.qdistroPwd.save("https://example.com/", "alice", "s3cret", { nonce: "n3" });
    const req = replyTo("pwd.save", { saved: true });
    expect(req).toMatchObject({
      url: "https://example.com/",
      username: "alice",
      password: "s3cret",
      intent_token: { nonce: "n3" },
    });
    await p;
  });

  // --- pwd.fill_confirm (phase 2) ----------------------------------

  it("fillConfirm() sends pwd.fill_confirm with url/username/fill_token/intent", async () => {
    const p = env.scope.qdistroPwd.fillConfirm(
      "https://example.com/", "alice", "ft-abc", { nonce: "nc1" });
    const req = replyTo("pwd.fill_confirm", {
      credentials: [{ username: "alice", password: "s3cret" }],
    });
    expect(req).toMatchObject({
      url: "https://example.com/",
      username: "alice",
      fill_token: "ft-abc",
      intent_token: { nonce: "nc1" },
    });
    await p;
  });

  it("fillConfirm() resolves with the released password", async () => {
    const p = env.scope.qdistroPwd.fillConfirm(
      "https://example.com/", "alice", "ft-abc", { nonce: "nc2" });
    replyTo("pwd.fill_confirm", {
      credentials: [{ username: "alice", password: "s3cret", url: "https://example.com" }],
    });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.credentials[0]).toMatchObject({ username: "alice", password: "s3cret" });
  });

  it("fillConfirm() surfaces an invalid/expired token as ok:false", async () => {
    const p = env.scope.qdistroPwd.fillConfirm(
      "https://example.com/", "alice", "stale", { nonce: "nc3" });
    const req = env.port.sent.find((m) => m.op === "pwd.fill_confirm");
    env.port.deliver({
      op: "pwd.fill_confirm.reply",
      request_id: req.request_id,
      ok: false,
      error: "invalid_token",
    });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_token");
  });

  it("fill() resolves with the bridge reply body", async () => {
    const p = env.scope.qdistroPwd.fill("https://example.com/", "alice", { nonce: "n4" });
    replyTo("pwd.fill", { credentials: [{ username: "alice", password: "x" }] });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.credentials).toHaveLength(1);
  });

  // P04-C: autofill_denied error round-trips so the content script
  // can surface the right UI affordance.
  it("fill() surfaces autofill_denied as ok:false", async () => {
    const p = env.scope.qdistroPwd.fill("https://example.com/", null, { nonce: "n5" });
    const req = env.port.sent.find((m) => m.op === "pwd.fill");
    env.port.deliver({
      op: "pwd.fill.reply",
      request_id: req.request_id,
      ok: false,
      error: "autofill_denied",
    });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("autofill_denied");
  });

  it("fill() surfaces vault_locked as ok:false", async () => {
    const p = env.scope.qdistroPwd.fill("https://example.com/", null, { nonce: "n6" });
    const req = env.port.sent.find((m) => m.op === "pwd.fill");
    env.port.deliver({
      op: "pwd.fill.reply",
      request_id: req.request_id,
      ok: false,
      error: "vault_locked",
    });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("vault_locked");
  });
});
