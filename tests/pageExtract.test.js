// pageExtract module — context-menu-driven capture.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadExtension, makeFakeBrowser, makeFakePort } from "./helpers.js";

describe("qdistroPageExtract", () => {
  let env;
  beforeEach(() => {
    const browser = makeFakeBrowser();
    browser.scripting.executeScript = () => Promise.resolve([{
      result: { selected_text: "hello", url: "https://x/", title: "X" },
    }]);
    env = loadExtension({ browser, portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
  });

  it("capture() returns the script's result payload", async () => {
    const cap = await env.scope.qdistroPageExtract.capture(7);
    expect(cap).toEqual({
      selected_text: "hello",
      url: "https://x/",
      title: "X",
    });
  });

  it("extract() forwards the captured payload to the bridge", async () => {
    const token = await env.scope.qdistroIntent.mint("page.extract");
    env.scope.qdistroPageExtract.extract(7, "selection", token);
    const req = await vi.waitFor(
      () => {
        const m = env.port.sent.find((x) => x.op === "page.extract");
        if (!m) throw new Error("page.extract not yet sent");
        return m;
      },
      { timeout: 1000 },
    );
    expect(req).toMatchObject({
      selected_text: "hello",
      url: "https://x/",
      title: "X",
      destination: "selection",
    });
    expect(req.intent_token.request_id).toBeTruthy();
    expect(req.intent_token.op).toBe("page.extract");
    expect(req.intent_token.hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("installContextMenu() registers the qdistro-share-to entry", () => {
    const calls = [];
    const browser = makeFakeBrowser();
    browser.contextMenus.create = (def) => { calls.push(def); };
    const env2 = loadExtension({ browser, portHandle: makeFakePort() });
    env2.scope.qdistroPort.connect();
    env2.scope.qdistroPageExtract.installContextMenu();
    expect(calls[0]).toMatchObject({
      id: "qdistro-share-to",
      contexts: ["selection", "page", "link"],
    });
  });

  it("captures empty selection without throwing", async () => {
    const browser = makeFakeBrowser();
    browser.scripting.executeScript = () => Promise.resolve([{ result: undefined }]);
    const env2 = loadExtension({ browser, portHandle: makeFakePort() });
    env2.scope.qdistroPort.connect();
    const cap = await env2.scope.qdistroPageExtract.capture(1);
    expect(cap).toEqual({ selected_text: "", url: "", title: "" });
  });
});
