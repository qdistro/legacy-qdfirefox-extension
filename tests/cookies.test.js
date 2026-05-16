// cookies module — extension-initiated, intent-token-gated.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadExtension, makeFakeBrowser, makeFakePort } from "./helpers.js";

describe("qdistroCookies", () => {
  let env;
  beforeEach(() => {
    const browser = makeFakeBrowser();
    browser.cookies.getAll = (_q) => Promise.resolve([
      { name: "sid", value: "abc", domain: ".example.com", path: "/",
        secure: true, httpOnly: true, sameSite: "lax", expirationDate: 1700000000,
        storeId: "firefox-default", firstPartyDomain: "" },
    ]);
    env = loadExtension({ browser, portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
  });

  it("requires an intent token", async () => {
    await expect(env.scope.qdistroCookies.exportForUrl("https://example.com/", null))
      .rejects.toThrow(/intent_token_required/);
  });

  it("serializes cookies with snake_case fields and store_id", async () => {
    const token = await env.scope.qdistroIntent.mint("cookies.export");
    const p = env.scope.qdistroCookies.exportForUrl("https://example.com/", token);
    // exportForUrl awaits getAllForUrl → cookies.getAll, then dispatcher.request
    // → port.send. That's a 2-hop microtask chain; vi.waitFor polls until the
    // send lands rather than gambling on macrotask ordering.
    const req = await vi.waitFor(
      () => {
        const m = env.port.sent.find((x) => x.op === "cookies.export");
        if (!m) throw new Error("cookies.export not yet sent");
        return m;
      },
      { timeout: 1000 },
    );
    expect(req.cookies[0]).toMatchObject({
      name: "sid", domain: ".example.com",
      http_only: true, same_site: "lax",
      expires: 1700000000, store_id: "firefox-default",
    });
    env.port.deliver({
      op: "cookies.export.reply", request_id: req.request_id,
      ok: true, accepted: 1,
    });
    const r = await p;
    expect(r.ok).toBe(true);
  });

  it("forwards firstPartyDomain:null on the cookies.getAll query", async () => {
    let captured = null;
    const browser = makeFakeBrowser();
    browser.cookies.getAll = (q) => { captured = q; return Promise.resolve([]); };
    const env2 = loadExtension({ browser, portHandle: makeFakePort() });
    env2.scope.qdistroPort.connect();
    const token = await env2.scope.qdistroIntent.mint("cookies.export");
    env2.scope.qdistroCookies.exportForUrl("https://example.com/", token);
    await vi.waitFor(() => {
      if (!captured) throw new Error("getAll not yet called");
    }, { timeout: 1000 });
    expect(captured).toMatchObject({
      url: "https://example.com/",
      firstPartyDomain: null,
    });
  });

  it("scopes getAll to storeId when cookieStoreId is passed", async () => {
    let captured = null;
    const browser = makeFakeBrowser();
    browser.cookies.getAll = (q) => { captured = q; return Promise.resolve([]); };
    const env2 = loadExtension({ browser, portHandle: makeFakePort() });
    env2.scope.qdistroPort.connect();
    const token = await env2.scope.qdistroIntent.mint("cookies.export");
    env2.scope.qdistroCookies.exportForUrl("https://example.com/", token, {
      cookieStoreId: "firefox-container-3",
    });
    await vi.waitFor(() => {
      if (!captured || !captured.storeId) throw new Error("storeId not yet seen");
    }, { timeout: 1000 });
    expect(captured.storeId).toBe("firefox-container-3");
  });

  it("surfaces a missing cookies API as cookies_api_unavailable", async () => {
    const browser = makeFakeBrowser();
    browser.cookies = undefined;
    const env2 = loadExtension({ browser, portHandle: makeFakePort() });
    env2.scope.qdistroPort.connect();
    const token = await env2.scope.qdistroIntent.mint("cookies.export");
    await expect(env2.scope.qdistroCookies.exportForUrl("https://x/", token))
      .rejects.toThrow(/cookies_api_unavailable/);
  });
});
