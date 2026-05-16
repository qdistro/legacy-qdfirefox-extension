// Port lifecycle: connect, heartbeat-ack, disconnect-and-reconnect.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadExtension } from "./helpers.js";

describe("qdistroPort", () => {
  let env;

  beforeEach(() => {
    env = loadExtension();
    env.scope.qdistroPort.connect();
  });

  it("opens a port on connect()", () => {
    expect(env.scope.qdistroPort.isConnected()).toBe(true);
  });

  it("replies to qdistro.heartbeat with qdistro.heartbeat.ack", () => {
    env.port.deliver({ op: "qdistro.heartbeat", echo: "tick-1" });
    expect(env.port.sent.at(-1)).toEqual({
      op: "qdistro.heartbeat.ack",
      echo: "tick-1",
    });
  });

  it("transitions to disconnected on port.disconnect", () => {
    env.port.triggerDisconnect();
    expect(env.scope.qdistroPort.isConnected()).toBe(false);
  });

  it("schedules a reconnect after disconnect", () => {
    vi.useFakeTimers();
    try {
      const env2 = loadExtension();
      env2.scope.qdistroPort.connect();
      env2.port.triggerDisconnect();
      expect(env2.scope.qdistroPort.isConnected()).toBe(false);
      vi.advanceTimersByTime(1100);
      expect(env2.scope.qdistroPort.isConnected()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("send() returns false when disconnected", () => {
    env.port.triggerDisconnect();
    const ok = env.scope.qdistroPort.send({ op: "test" });
    expect(ok).toBe(false);
  });

  it("statusListeners are notified on connect/disconnect", () => {
    const env2 = loadExtension();
    const seen = [];
    env2.scope.qdistroPort.onStatus((s) => seen.push(s));
    env2.scope.qdistroPort.connect();
    env2.port.triggerDisconnect();
    expect(seen.some((s) => s.connected === true)).toBe(true);
    expect(seen.some((s) => s.connected === false)).toBe(true);
  });
});
