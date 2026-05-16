// notifications module — show only (inbound). Outbound click/close
// emission was dropped: the bridge has no handler and the
// browser.notifications API only sees extension-owned notifications.
import { describe, it, expect, beforeEach } from "vitest";
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

  it("does not emit notifications.event on click/close", async () => {
    browser.notifications.onClicked.fire("n-123");
    browser.notifications.onClosed.fire("n-7", true);
    await new Promise((r) => setTimeout(r, 0));
    const events = env.port.sent.filter((m) => m.op === "notifications.event");
    expect(events).toHaveLength(0);
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
