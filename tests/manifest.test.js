// manifest.json shape tests. Pin invariants that the build script
// would silently break: which content scripts inject into iframes,
// background module order, host permissions.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "..", "manifest.json"), "utf8")
);

describe("manifest.json content_scripts", () => {
  it("splits pwd-content (all_frames:true) from mpris/screenlock (top frame only)", () => {
    const cs = manifest.content_scripts;
    expect(Array.isArray(cs)).toBe(true);
    expect(cs).toHaveLength(2);

    const pwd = cs.find((e) => e.js.some((p) => p.endsWith("pwd-content.js")));
    expect(pwd).toBeTruthy();
    expect(pwd.all_frames).toBe(true);
    expect(pwd.js).toEqual(["src/content/pwd-content.js"]);

    const others = cs.find((e) => e.js.some((p) => p.endsWith("mpris-content.js")));
    expect(others).toBeTruthy();
    expect(others.all_frames).toBe(false);
    expect(others.js).toContain("src/content/mpris-content.js");
    expect(others.js).toContain("src/content/screenlock-content.js");
    expect(others.js).not.toContain("src/content/pwd-content.js");
  });
});

// P04-E parity check — P0-5 fix. The pwd.fill content script
// needs scripting + webNavigation to inject into freshly-navigated
// frames. Both must be declared.
describe("manifest.json permissions (P04-E parity)", () => {
  it("declares nativeMessaging for the bridge port", () => {
    expect(manifest.permissions).toContain("nativeMessaging");
  });

  it("declares scripting for pwd-content injection", () => {
    expect(manifest.permissions).toContain("scripting");
  });

  it("declares webNavigation for pwd-fill on freshly navigated frames", () => {
    expect(manifest.permissions).toContain("webNavigation");
  });

  it("keeps contextualIdentities (Firefox containers)", () => {
    expect(manifest.permissions).toContain("contextualIdentities");
  });

  it("MV3 host_permissions covers all urls", () => {
    expect(manifest.host_permissions).toContain("<all_urls>");
  });

  // P04 fix-pass S4 (test-integrity): closed-set assertion so a
  // future commit silently adding ``management`` / ``proxy`` /
  // ``bookmarks`` etc. fails the test. The full set of acceptable
  // permissions for this extension is pinned here. New permissions
  // require updating this allowlist + a security review.
  it("permissions set is closed — no silently-added permissions", () => {
    const expected = new Set([
      "nativeMessaging",
      "tabs",
      "activeTab",
      "cookies",
      "downloads",
      "notifications",
      "contextMenus",
      "contextualIdentities",
      "scripting",
      "webNavigation",
      "storage",
    ]);
    const actual = new Set(manifest.permissions || []);
    for (const p of actual) {
      expect(
        expected.has(p),
        `unexpected permission ${p} — update the closed-set allowlist after security review`,
      ).toBe(true);
    }
    // And confirm every expected permission is present, so a future
    // commit also can't silently DROP a load-bearing one.
    for (const p of expected) {
      expect(actual.has(p), `missing permission ${p}`).toBe(true);
    }
  });
});
