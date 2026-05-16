// mpris module — stub-grade, but the dispatcher shape is real.
import { describe, it, expect, beforeEach } from "vitest";
import { loadExtension } from "./helpers.js";

describe("qdistroMpris", () => {
  let env;
  beforeEach(() => {
    env = loadExtension();
    env.scope.qdistroPort.connect();
  });

  it("mpris.control replies with the stubbed action echo", async () => {
    await env.scope.qdistroDispatcher.handleInbound({
      op: "mpris.control", request_id: 1, action: "play",
    });
    const reply = env.port.sent.find((m) => m.op === "mpris.control.reply");
    expect(reply).toMatchObject({ ok: true, action: "play", stub: true });
  });

  it("update() sends mpris.update with the given payload", () => {
    env.scope.qdistroMpris.update({ title: "Song", state: "playing" });
    const req = env.port.sent.find((m) => m.op === "mpris.update");
    expect(req).toMatchObject({ title: "Song", state: "playing" });
  });
});
