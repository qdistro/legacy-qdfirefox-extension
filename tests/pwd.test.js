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

  it("fill() resolves with the bridge reply body", async () => {
    const p = env.scope.qdistroPwd.fill("https://example.com/", "alice", { nonce: "n4" });
    replyTo("pwd.fill", { credentials: [{ username: "alice", password: "x" }] });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.credentials).toHaveLength(1);
  });
});
