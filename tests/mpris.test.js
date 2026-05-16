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

  it("update() sends mpris.publish with bridge-shaped fields", () => {
    env.scope.qdistroMpris.update({
      title: "Song", artist: "A", album: "B",
      state: "playing", position: 12, tab_id: 7,
    });
    const req = env.port.sent.find((m) => m.op === "mpris.publish");
    expect(req).toMatchObject({
      title: "Song", artist: "A", album: "B",
      playback_status: "playing",
      position_us: 12000000,
      tab_id: 7,
    });
  });

  it("update() defaults playback_status to 'none' and position_us to 0", () => {
    env.scope.qdistroMpris.update({ title: "X" });
    const req = env.port.sent.find((m) => m.op === "mpris.publish");
    expect(req.playback_status).toBe("none");
    expect(req.position_us).toBe(0);
  });
});
