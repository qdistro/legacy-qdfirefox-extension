// downloads module — onChanged listener forwards snapshots.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadExtension, makeFakeBrowser, makeFakePort } from "./helpers.js";

describe("qdistroDownloads", () => {
  let env;
  let browser;
  beforeEach(() => {
    browser = makeFakeBrowser();
    env = loadExtension({ browser, portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
    env.scope.qdistroDownloads.install();
  });

  it("snapshot() converts a download item to the wire shape", () => {
    const s = env.scope.qdistroDownloads.snapshot({
      id: 1, url: "https://x/a.bin", filename: "/tmp/a.bin",
      state: "complete", totalBytes: 1024, bytesReceived: 1024,
      mime: "application/octet-stream", startTime: "2024-01-01",
    });
    expect(s).toMatchObject({
      id: 1, url: "https://x/a.bin", filename: "/tmp/a.bin",
      state: "complete", total_bytes: 1024, bytes_received: 1024,
      mime: "application/octet-stream",
    });
  });

  it("onChanged fires downloads.update via dispatcher", async () => {
    browser.downloads.search = (_q) => Promise.resolve([{
      id: 42, url: "https://x/", filename: "/tmp/x",
      state: "in_progress", totalBytes: 0, bytesReceived: 0,
    }]);
    browser.downloads.onChanged.fire({ id: 42, state: { current: "in_progress" } });
    const req = await vi.waitFor(
      () => {
        const m = env.port.sent.find((x) => x.op === "downloads.update");
        if (!m) throw new Error("downloads.update not yet sent");
        return m;
      },
      { timeout: 1000 },
    );
    expect(req.id).toBe(42);
  });

  it("install() is a no-op when downloads API is missing", () => {
    const browser2 = makeFakeBrowser();
    browser2.downloads = undefined;
    const env2 = loadExtension({ browser: browser2, portHandle: makeFakePort() });
    expect(() => env2.scope.qdistroDownloads.install()).not.toThrow();
  });
});
