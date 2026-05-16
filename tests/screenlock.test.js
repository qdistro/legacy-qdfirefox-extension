// screenlock module — outbound-only inhibit/release.
import { describe, it, expect, beforeEach } from "vitest";
import { loadExtension } from "./helpers.js";

describe("qdistroScreenlock", () => {
  let env;
  beforeEach(() => {
    env = loadExtension();
    env.scope.qdistroPort.connect();
  });

  it("inhibit() sends screenlock.inhibit with a default reason", () => {
    env.scope.qdistroScreenlock.inhibit();
    const req = env.port.sent.find((m) => m.op === "screenlock.inhibit");
    expect(req).toMatchObject({ reason: "fullscreen_video" });
  });

  it("release() sends screenlock.release with the given reason", () => {
    env.scope.qdistroScreenlock.release("user_dismissed");
    const req = env.port.sent.find((m) => m.op === "screenlock.release");
    expect(req).toMatchObject({ reason: "user_dismissed" });
  });
});
