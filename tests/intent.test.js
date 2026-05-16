// intent.js tests — the per-call MVP token minter.
//
// Tokens are {operation, timestamp, ttl_ms, nonce, hmac} with a 5s
// TTL. MVP shape mints unsigned tokens (hmac=null) until the bridge
// handshake lands.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadExtension } from "./helpers.js";

describe("qdistroIntent", () => {
  let env;
  beforeEach(() => {
    env = loadExtension();
  });

  it("exposes mint / setSessionSecret / ttlMs", () => {
    expect(env.scope.qdistroIntent).toBeTruthy();
    expect(typeof env.scope.qdistroIntent.mint).toBe("function");
    expect(typeof env.scope.qdistroIntent.setSessionSecret).toBe("function");
    expect(typeof env.scope.qdistroIntent.ttlMs).toBe("function");
  });

  it("ttlMs() reports the 5000ms default", () => {
    expect(env.scope.qdistroIntent.ttlMs()).toBe(5000);
  });

  it("mint() returns a token with the canonical fields", () => {
    const t = env.scope.qdistroIntent.mint("cookies.export");
    expect(t).toMatchObject({
      operation: "cookies.export",
      ttl_ms: 5000,
    });
    expect(typeof t.timestamp).toBe("number");
    expect(typeof t.nonce).toBe("string");
    expect(t.nonce.length).toBeGreaterThan(0);
  });

  it("mint() honors an explicit TTL override", () => {
    const t = env.scope.qdistroIntent.mint("pwd.fill", 1500);
    expect(t.ttl_ms).toBe(1500);
  });

  it("mint() coerces a missing operation to the empty string", () => {
    const t = env.scope.qdistroIntent.mint();
    expect(t.operation).toBe("");
  });

  it("mint() returns hmac=null pre-handshake", () => {
    const t = env.scope.qdistroIntent.mint("page.extract");
    expect(t.hmac).toBeNull();
  });

  it("mint() still returns hmac=null after setSessionSecret (placeholder)", () => {
    env.scope.qdistroIntent.setSessionSecret("test-secret");
    const t = env.scope.qdistroIntent.mint("pwd.save");
    expect(t.hmac).toBeNull();
  });

  it("each mint() produces a unique nonce", () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      seen.add(env.scope.qdistroIntent.mint("op").nonce);
    }
    expect(seen.size).toBe(20);
  });

  it("timestamp tracks Date.now() (via fake timers)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-06-01T00:00:00Z"));
      const t = env.scope.qdistroIntent.mint("op");
      expect(t.timestamp).toBe(Date.parse("2024-06-01T00:00:00Z"));
    } finally {
      vi.useRealTimers();
    }
  });
});
