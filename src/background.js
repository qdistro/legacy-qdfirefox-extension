// qdistro browser-bridge background — Firefox MV3 event page.
//
// All sibling sources (api.js, port.js, dispatcher.js, intent.js, the
// modules under modules/) are listed in manifest.background.scripts
// and loaded in declared order. By the time this file runs, every
// module has attached its exports onto `self.qdistro*`.
//
// Boot sequence:
//   1. Wire context menus and event-listener installs (downloads,
//      notifications) once per event-page lifetime.
//   2. Open the persistent native-messaging port. Reconnect-with-
//      backoff + 25s heartbeat watchdog live inside port.js.
//   3. Handle popup → background runtime.sendMessage so the popup
//      can drive the persistent port without opening its own
//      connectNative (Firefox allows multiple native ports per
//      session, but one host per session is the cleaner contract
//      and matches qdchrome-extension).
//
// @ts-check

const api = self.qdistroApi;

// Handshake fires the moment a port becomes live (boot, reconnect).
// Replaces any prior session secret with the fresh per-port one the
// bridge minted. Privileged-op sites await `qdistroIntent.hasSession()`
// before calling `mint()` — if the handshake hasn't completed yet,
// the op throws `intent_no_session` which the caller surfaces.
async function runHandshake() {
  try {
    const reply = await self.qdistroDispatcher.request("qdistro.handshake", {
      proto_version: 1,
    }, { timeoutMs: 5000 });
    if (reply && reply.ok && typeof reply.session_secret_hex === "string") {
      self.qdistroIntent.setSessionSecretHex(reply.session_secret_hex);
    } else {
      console.warn("[qdistro/background] handshake reply missing secret", reply);
    }
  } catch (e) {
    console.warn("[qdistro/background] handshake failed", e && e.message);
  }
}

function bootOnce() {
  if (self.__qdistroBooted) return;
  self.__qdistroBooted = true;

  if (self.qdistroPageExtract) self.qdistroPageExtract.installContextMenu();
  if (self.qdistroDownloads)   self.qdistroDownloads.install();
  if (self.qdistroNotifications) self.qdistroNotifications.install();

  // Handshake on every (re)connect — bridge rotates its secret on
  // each launch, so a stale extension secret won't pass verification.
  self.qdistroPort.onConnected(runHandshake);
  self.qdistroPort.connect();
}

if (api && api.runtime && api.runtime.onStartup) {
  api.runtime.onStartup.addListener(bootOnce);
}
if (api && api.runtime && api.runtime.onInstalled) {
  api.runtime.onInstalled.addListener(bootOnce);
}

// Cold-start (event page woken by an event past onStartup): boot
// inline so the port is ready by the time the first request arrives.
bootOnce();

// Per-tab screenlock-inhibit accounting. The compositor's
// idle-inhibit protocol is reference-counted on the bridge side,
// but we still need to clean up if a tab vanishes without firing
// `pagehide` (e.g. crashed renderer).
const screenlockTabs = new Set();
if (api && api.tabs && api.tabs.onRemoved) {
  api.tabs.onRemoved.addListener((tabId) => {
    if (screenlockTabs.delete(tabId) && self.qdistroScreenlock) {
      self.qdistroScreenlock.release("tab_removed").catch(() => {});
    }
  });
}

// Resolve the popup's extension-internal URL. The Firefox manifest
// declares default_popup as "src/popup.html".
function popupUrl() {
  try { return api.runtime.getURL("src/popup.html"); } catch (_) { return null; }
}

// A trusted popup sender: our own extension id, an extension-page
// origin (no sender.tab — content scripts always carry a tab), and
// the sender.url is exactly our popup page. Gates consent-bearing
// operations (cookie export) so a content-script bug can't mint them.
function isPopupSender(sender) {
  if (!sender || sender.id !== api.runtime.id) return false;
  if (sender.tab) return false; // content scripts carry a tab
  const want = popupUrl();
  return !!want && sender.url === want;
}

// Active tab in the current window, derived in the background rather
// than trusting caller-supplied req fields. A SINGLE tabs.query for
// both the URL and the container store id: two separate queries had a
// small TOCTOU window (the active tab could change between calls) and
// were redundant (finding #10 follow-up).
async function activeTab() {
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return (tabs && tabs.length) ? tabs[0] : null;
  } catch (_) { return null; }
}

// For content-script-initiated pwd ops: the authoritative URL is
// sender.tab.url (set by the browser), never req.url. Reject when
// the content script's claimed URL disagrees with the real frame.
function pwdSenderUrl(req, sender) {
  const tabUrl = (sender && sender.tab && sender.tab.url) || "";
  if (!tabUrl) return { ok: false, error: "no_tab_url" };
  if (req && typeof req.url === "string" && req.url && req.url !== tabUrl) {
    return { ok: false, error: "url_mismatch" };
  }
  return { ok: true, url: tabUrl };
}

// Popup ↔ background channel.
if (api && api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((req, sender) => {
    // Reject anything that isn't our own popup/options page or one
    // of our content scripts. Without `externally_connectable` in
    // the manifest, Firefox already refuses cross-extension and
    // page-context sendMessage calls; this is defense-in-depth.
    if (!sender || sender.id !== api.runtime.id) {
      return Promise.resolve({ ok: false, error: "untrusted_sender" });
    }
    if (!req || typeof req !== "object") {
      return Promise.resolve({ ok: false, error: "bad_request" });
    }
    return (async () => {
      try {
        switch (req.kind) {
          case "status":
            return { ok: true, connected: self.qdistroPort.isConnected() };
          case "ping": {
            const r = await self.qdistroDispatcher.request("qdistro.ping", {
              echo: String(Date.now()),
            }, { timeoutMs: 5000 });
            return { ok: true, response: r };
          }
          case "cookies.export": {
            // Consent gate (finding #11): cookie export carries no
            // per-op confirmation, so the ONLY trusted caller is our
            // own popup. Reject content-script / non-popup senders and
            // derive both the URL and the container store id from the
            // active tab instead of trusting req.url / req.cookie_store_id.
            if (!isPopupSender(sender)) {
              return { ok: false, error: "popup_required" };
            }
            const tab = await activeTab();
            const url = tab ? (tab.url || "") : "";
            if (!url) {
              return { ok: false, error: "no_active_tab" };
            }
            const storeId = (tab && tab.cookieStoreId) || null;
            const intent = await self.qdistroIntent.mint("cookies.export");
            const opts = storeId ? { cookieStoreId: storeId } : {};
            const r = await self.qdistroCookies.exportForUrl(url, intent, opts);
            return { ok: true, response: r };
          }
          case "containers.list": {
            if (!self.qdistroContainers) {
              return { ok: false, error: "containers_module_missing" };
            }
            return { ok: true, containers: await self.qdistroContainers.list() };
          }

          // ---- content-script entry points ---------------------------
          // Each mints/forwards an intent token where the bridge
          // requires one; tokens carry hmac=null in MVP (see
          // todo/06-intent-token-hmac.md).

          case "pwd.request_fill": {
            // Finding #10: the page-supplied req.url is untrusted.
            // Derive the URL from sender.tab.url and reject when the
            // content script's claim disagrees with the real frame.
            const su = pwdSenderUrl(req, sender);
            if (!su.ok) return { ok: false, error: su.error };
            const intent = await self.qdistroIntent.mint("pwd.fill");
            const r = await self.qdistroPwd.fill(
              su.url,
              req.username || null,
              intent,
            );
            return { ok: true, response: r };
          }
          case "pwd.request_save": {
            const su = pwdSenderUrl(req, sender);
            if (!su.ok) return { ok: false, error: su.error };
            const intent = await self.qdistroIntent.mint("pwd.save");
            const r = await self.qdistroPwd.save(
              su.url,
              req.username || null,
              req.password || "",
              intent,
            );
            return { ok: true, response: r };
          }
          case "mpris.report_update": {
            // Fire-and-forget — the page polls 1Hz; we don't want
            // the content script blocked waiting on a wire ack.
            self.qdistroMpris.update({
              title: req.title || "",
              artist: req.artist || "",
              album: req.album || "",
              art_url: req.art_url || "",
              state: req.state || "none",
              position: typeof req.position === "number" ? req.position : null,
              duration: typeof req.duration === "number" ? req.duration : null,
              url: req.url || (sender.url || ""),
              tab_id: (sender.tab && sender.tab.id) || null,
            }).catch(() => {});
            return { ok: true };
          }
          case "screenlock.report_inhibit": {
            const tabId = sender.tab && sender.tab.id;
            if (typeof tabId === "number") screenlockTabs.add(tabId);
            self.qdistroScreenlock.inhibit(req.reason || "fullscreen_video")
              .catch(() => {});
            return { ok: true };
          }
          case "screenlock.report_release": {
            const tabId = sender.tab && sender.tab.id;
            if (typeof tabId === "number") screenlockTabs.delete(tabId);
            self.qdistroScreenlock.release(req.reason || "fullscreen_exit")
              .catch(() => {});
            return { ok: true };
          }

          default:
            return { ok: false, error: "unknown_kind" };
        }
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    })();
  });
}
