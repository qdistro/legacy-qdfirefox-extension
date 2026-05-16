// background.js — runtime.onMessage entry points for popup and the
// pwd/mpris/screenlock content scripts.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadWithBackground, makeFakeBrowser, makeFakePort } from "./helpers.js";

describe("background runtime.onMessage", () => {
  let env;
  beforeEach(() => {
    env = loadWithBackground();
    env.scope.qdistroPort.connect();
  });

  it("rejects messages whose sender.id != runtime.id", async () => {
    const r = await env.sendMessage({ kind: "status" }, { id: "evil-ext-id" });
    expect(r).toEqual({ ok: false, error: "untrusted_sender" });
  });

  it("rejects non-object payloads", async () => {
    const r = await env.sendMessage("nope");
    expect(r).toEqual({ ok: false, error: "bad_request" });
  });

  it("status returns the current port connectedness", async () => {
    const r = await env.sendMessage({ kind: "status" });
    expect(r).toEqual({ ok: true, connected: true });
  });

  it("unknown kind returns unknown_kind", async () => {
    const r = await env.sendMessage({ kind: "no-such-kind" });
    expect(r).toEqual({ ok: false, error: "unknown_kind" });
  });

  describe("pwd content-script entry points", () => {
    it("pwd.request_fill mints an intent token and forwards as pwd.fill", async () => {
      const p = env.sendMessage({
        kind: "pwd.request_fill",
        url: "https://example.com/login",
        username: "alice",
      });
      const req = await vi.waitFor(() => {
        const m = env.port.sent.find((x) => x.op === "pwd.fill");
        if (!m) throw new Error("pwd.fill not yet sent");
        return m;
      }, { timeout: 1000 });
      expect(req.url).toBe("https://example.com/login");
      expect(req.username).toBe("alice");
      expect(req.intent_token).toBeTruthy();
      expect(req.intent_token.op).toBe("pwd.fill");
      env.port.deliver({
        op: "pwd.fill.reply", request_id: req.request_id, ok: true,
        credentials: [{ username: "alice", password: "secret" }],
      });
      const r = await p;
      expect(r.ok).toBe(true);
      expect(r.response.credentials).toHaveLength(1);
    });

    it("pwd.request_save mints a pwd.save token and forwards credentials", async () => {
      const p = env.sendMessage({
        kind: "pwd.request_save",
        url: "https://example.com/login",
        username: "alice",
        password: "s3cret!",
      });
      const req = await vi.waitFor(() => {
        const m = env.port.sent.find((x) => x.op === "pwd.save");
        if (!m) throw new Error("pwd.save not yet sent");
        return m;
      }, { timeout: 1000 });
      expect(req).toMatchObject({
        url: "https://example.com/login",
        username: "alice",
        password: "s3cret!",
      });
      expect(req.intent_token.op).toBe("pwd.save");
      env.port.deliver({
        op: "pwd.save.reply", request_id: req.request_id, ok: true, saved: true,
      });
      const r = await p;
      expect(r.ok).toBe(true);
    });
  });

  describe("mpris content-script entry point", () => {
    it("mpris.report_update forwards as mpris.publish (fire-and-forget)", async () => {
      const r = await env.sendMessage({
        kind: "mpris.report_update",
        title: "Song", artist: "Artist", state: "playing",
        url: "https://music.example/",
      });
      expect(r).toEqual({ ok: true });
      const req = await vi.waitFor(() => {
        const m = env.port.sent.find((x) => x.op === "mpris.publish");
        if (!m) throw new Error("mpris.publish not yet sent");
        return m;
      }, { timeout: 1000 });
      expect(req).toMatchObject({
        title: "Song", artist: "Artist", playback_status: "playing",
      });
    });

    it("includes tab_id when sender carries a tab", async () => {
      env.sendMessage(
        { kind: "mpris.report_update", title: "X", state: "playing" },
        { id: env.scope.browser.runtime.id, tab: { id: 42 } },
      );
      const req = await vi.waitFor(() => {
        const m = env.port.sent.find((x) => x.op === "mpris.publish");
        if (!m) throw new Error("mpris.publish not yet sent");
        return m;
      }, { timeout: 1000 });
      expect(req.tab_id).toBe(42);
    });
  });

  describe("screenlock content-script entry points", () => {
    it("screenlock.report_inhibit forwards as screenlock.inhibit", async () => {
      const r = await env.sendMessage({
        kind: "screenlock.report_inhibit",
        reason: "fullscreen_video",
      });
      expect(r).toEqual({ ok: true });
      const req = await vi.waitFor(() => {
        const m = env.port.sent.find((x) => x.op === "screenlock.inhibit");
        if (!m) throw new Error("screenlock.inhibit not yet sent");
        return m;
      }, { timeout: 1000 });
      expect(req).toMatchObject({ reason: "fullscreen_video" });
    });

    it("screenlock.report_release forwards as screenlock.release", async () => {
      await env.sendMessage({
        kind: "screenlock.report_release", reason: "fullscreen_exit",
      });
      const req = await vi.waitFor(() => {
        const m = env.port.sent.find((x) => x.op === "screenlock.release");
        if (!m) throw new Error("screenlock.release not yet sent");
        return m;
      }, { timeout: 1000 });
      expect(req).toMatchObject({ reason: "fullscreen_exit" });
    });

    it("tabs.onRemoved fires a release for any tab that had an active inhibit", async () => {
      // Establish a per-tab inhibit.
      await env.sendMessage(
        { kind: "screenlock.report_inhibit", reason: "fullscreen_video" },
        { id: env.scope.browser.runtime.id, tab: { id: 7 } },
      );
      // Wait for the inhibit to be sent.
      await vi.waitFor(() => {
        if (!env.port.sent.find((x) => x.op === "screenlock.inhibit")) {
          throw new Error("inhibit not yet sent");
        }
      }, { timeout: 1000 });
      const beforeReleases = env.port.sent.filter((m) => m.op === "screenlock.release").length;
      // Fire the tab-removed event.
      const tabRemovedListeners = env.scope.browser.tabs.onRemoved._listeners;
      for (const cb of tabRemovedListeners) cb(7, { isWindowClosing: false });
      await vi.waitFor(() => {
        const after = env.port.sent.filter((m) => m.op === "screenlock.release").length;
        if (after <= beforeReleases) throw new Error("release not yet sent");
      }, { timeout: 1000 });
      const release = env.port.sent.filter((m) => m.op === "screenlock.release").at(-1);
      expect(release.reason).toBe("tab_removed");
    });

    it("does NOT fire a release for a tab without an active inhibit", async () => {
      const tabRemovedListeners = env.scope.browser.tabs.onRemoved._listeners;
      for (const cb of tabRemovedListeners) cb(999, { isWindowClosing: false });
      // Give it a tick to be sure nothing leaks.
      await new Promise((r) => setTimeout(r, 30));
      const releases = env.port.sent.filter((m) => m.op === "screenlock.release");
      expect(releases).toHaveLength(0);
    });
  });
});
