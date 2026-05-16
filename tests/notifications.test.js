// notifications module — show / event forwarding.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadExtension, makeFakeBrowser, makeFakePort } from "./helpers.js";

describe("qdistroNotifications", () => {
  let env;
  let browser;
  beforeEach(() => {
    browser = makeFakeBrowser();
    env = loadExtension({ browser, portHandle: makeFakePort() });
    env.scope.qdistroPort.connect();
    env.scope.qdistroNotifications.install();
  });

  it("forwards onClicked as notifications.event {kind:'clicked'}", async () => {
    browser.notifications.onClicked.fire("n-123");
    const req = await vi.waitFor(
      () => {
        const m = env.port.sent.find((x) => x.op === "notifications.event");
        if (!m) throw new Error("notifications.event not yet sent");
        return m;
      },
      { timeout: 1000 },
    );
    expect(req).toMatchObject({ kind: "clicked", notification_id: "n-123" });
  });

  it("forwards onClosed with by_user flag", async () => {
    browser.notifications.onClosed.fire("n-7", true);
    const req = await vi.waitFor(
      () => {
        const m = env.port.sent.find((x) => x.op === "notifications.event");
        if (!m) throw new Error("notifications.event not yet sent");
        return m;
      },
      { timeout: 1000 },
    );
    expect(req).toMatchObject({
      kind: "closed", notification_id: "n-7", by_user: true,
    });
  });

  it("notifications.show creates a notification via the API", async () => {
    const calls = [];
    browser.notifications.create = (_id, opts) => {
      calls.push(opts);
      return Promise.resolve("created-1");
    };
    await env.scope.qdistroDispatcher.handleInbound({
      op: "notifications.show", request_id: 1,
      title: "T", message: "M",
    });
    expect(calls[0]).toMatchObject({
      type: "basic", title: "T", message: "M",
    });
    const reply = env.port.sent.find((m) => m.op === "notifications.show.reply");
    expect(reply.notification_id).toBe("created-1");
  });

  it("notifications.show errors when API is missing", async () => {
    const browser2 = makeFakeBrowser();
    browser2.notifications = undefined;
    const env2 = loadExtension({ browser: browser2, portHandle: makeFakePort() });
    env2.scope.qdistroPort.connect();
    await env2.scope.qdistroDispatcher.handleInbound({
      op: "notifications.show", request_id: 2, title: "T",
    });
    const reply = env2.port.sent.find((m) => m.op === "notifications.show.reply");
    expect(reply.error).toBe("notifications_unavailable");
  });
});
