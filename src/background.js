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

function bootOnce() {
  if (self.__qdistroBooted) return;
  self.__qdistroBooted = true;

  if (self.qdistroPageExtract) self.qdistroPageExtract.installContextMenu();
  if (self.qdistroDownloads)   self.qdistroDownloads.install();
  if (self.qdistroNotifications) self.qdistroNotifications.install();

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

// Popup ↔ background channel.
if (api && api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((req, sender) => {
    // Reject anything that isn't our own popup/options page. Without
    // `externally_connectable` in the manifest, Firefox already
    // refuses cross-extension and page-context sendMessage calls,
    // but a content script of *our* extension could in principle
    // call sendMessage with arbitrary URLs — defense-in-depth check.
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
            const intent = self.qdistroIntent.mint("cookies.export");
            const opts = req.cookie_store_id
              ? { cookieStoreId: req.cookie_store_id } : {};
            const r = await self.qdistroCookies.exportForUrl(req.url, intent, opts);
            return { ok: true, response: r };
          }
          case "containers.list": {
            if (!self.qdistroContainers) {
              return { ok: false, error: "containers_module_missing" };
            }
            return { ok: true, containers: await self.qdistroContainers.list() };
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
