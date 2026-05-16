# Agents notes — qdfirefox-extension

## Layout

Sibling of [qdchrome-extension](../qdchrome-extension). Same protocol, different host.

```
src/
  api.js          → self.qdistroApi = browser
  port.js         → self.qdistroPort
  dispatcher.js   → self.qdistroDispatcher
  intent.js       → self.qdistroIntent
  background.js   → boot
  modules/*.js    → self.qdistro<Module>
```

All sources are IIFEs attaching exports onto `self`. The Firefox MV3 event page is a flat `background.scripts` list — load order is what manifest.json declares.

## Differences from qdchrome-extension to keep in mind

- **API surface**: `browser.*` is Promise-returning. Module code uses `await api.tabs.query({})` directly — no callback wrappers, no `runtime.lastError` checks. Tests' synthetic `browser` must return Promises (see `tests/helpers.js`).
- **MV target**: MV3 only. There is no MV2 fallback path here. If you find yourself adding `try { importScripts(...) } catch { ... }`, stop — that's the wrong repo.
- **Containers**: `src/modules/containers.js` is Firefox-only. It uses `browser.contextualIdentities` which has no Chromium analogue.
- **Cookies**: callers can pass `cookieStoreId` for container scoping and `firstPartyDomain: null` is explicit in `getAll` queries.
- **runtime.onMessage**: Firefox supports returning a Promise from the listener — see `src/background.js`. Don't port back to the chrome.* `return true; sendResponse(...)` shape.

## Running tests in the VM

Per qdistro convention, integration tests run in the bats VM, not on the host. Unit tests (vitest) run on the host:

```bash
npm test                   # host, fast
just test-vm               # in the libvirt template (not yet wired)
```

## Build outputs

```bash
npm run build
# dist/firefox/        unpacked, load via about:debugging
# dist/firefox.xpi     packed, submit to AMO or install signed
```

## Native-host install

`scripts/install-native-host.sh` writes the manifest to `~/.mozilla/native-messaging-hosts/qdistro.json` (user) or `/usr/lib(64)/mozilla/native-messaging-hosts/qdistro.json` (`--system`). The extension ID is `qdistro-firefox@qdistro.local` — keep that in sync with `manifest.json` `browser_specific_settings.gecko.id` if it ever changes.

## What this repo does NOT contain

- The bridge daemon itself — lives in qdistro repo (`qdistro-browser-bridge` entry point).
- The qdbrowser Qt browser — lives in qdbrowser.
- Chromium-specific code or MV2 fallback — those live in qdchrome-extension.
