# qdfirefox-extension

Firefox MV3 WebExtension — native-messaging client for the qdistro browser bridge. Peer of [qdchrome-extension](../qdchrome-extension); same wire protocol, different host environment.

## Why a separate repo

qdchrome-extension can build a Firefox MV2 xpi (concatenated bundle, `chrome.*` callback API). This repo is the Firefox-native counterpart:

- **MV3** (`browser.scripts` event page, not the deprecated MV2 background page)
- **`browser.*` Promise API** throughout — no callback-shim
- **First-class containers / contextual identities** — the load-bearing reason this is a separate codebase rather than a build target

## Status

v0.2.0 — early. Same 8 modules as qdchrome-extension plus `containers`:

| Module           | Direction        | Ops                                                 |
|------------------|------------------|-----------------------------------------------------|
| `tabs`           | bridge → ext     | `tabs.list`, `tabs.open`, `tabs.close`              |
| `pwd`            | ext → bridge     | `pwd.fill`, `pwd.save`                              |
| `pageExtract`    | ext → bridge     | `page.extract`                                      |
| `cookies`        | ext → bridge     | `cookies.export` (intent token)                     |
| `containers`     | bridge → ext     | `containers.list`, `containers.create`, `containers.remove` (Firefox-only) |
| `mpris`          | both             | `mpris.update`, `mpris.control`                     |
| `downloads`      | ext → bridge     | `downloads.update`                                  |
| `notifications`  | both             | `notifications.show`, `notifications.event`         |
| `screenlock`     | ext → bridge     | `screenlock.inhibit`, `screenlock.release`          |

`tabs.open` accepts `cookie_store_id` to pin the new tab to a container; `cookies.export` accepts the same field to scope the export.

## Build

```bash
npm install
npm run build
# → dist/firefox/      unpacked tree (use about:debugging "Load Temporary Add-on")
# → dist/firefox.xpi   packed for AMO submission / signed install
```

## Test

```bash
npm test
```

Vitest, no jsdom. Each test loads the source files into a synthetic `self` global with a `browser.*` Promise-API shim — same shape as qdchrome-extension's helpers.

## Install (development)

```bash
# 1. Install the native-messaging host manifest
QDISTRO_BRIDGE_PATH=/path/to/qdistro-browser-bridge bash scripts/install-native-host.sh

# 2. Load the unpacked extension
#    Firefox → about:debugging → This Firefox → Load Temporary Add-on
#    Select dist/firefox/manifest.json

# 3. Verify
#    Click the toolbar action → "Ping" should show {ok: true, response: {...}}
```

The user-level native-host manifest lands at `~/.mozilla/native-messaging-hosts/qdistro.json`.

### Installing the xpi directly

`dist/firefox.xpi` is **unsigned**. Release Firefox refuses unsigned xpis. Three options:

1. **Temporary add-on** (recommended for dev). `about:debugging` → "Load Temporary Add-on" → pick `dist/firefox/manifest.json`. Unloads on Firefox restart.
2. **`web-ext run`**. Spawns a Firefox instance with the unpacked extension pre-loaded:
   ```bash
   web-ext run --source-dir dist/firefox --firefox /usr/bin/firefox
   ```
3. **Signed install via AMO**. Run `web-ext sign --api-key=... --api-secret=...` with an AMO account; the resulting xpi installs in any Firefox.

Firefox Developer Edition / Nightly with `xpinstall.signatures.required=false` also accepts unsigned xpis, but release Firefox won't.

## Security posture

This extension grants itself a wide host-permission (`<all_urls>`) plus `nativeMessaging`, `cookies`, and `scripting` — enough to read every cookie and inject scripts into every page if anything goes wrong. Two gates keep that surface honest:

1. **Sender check** (`src/background.js`). The `runtime.onMessage` listener rejects any sender whose id doesn't match the extension's own — only the popup/options page can drive the native port from inside the extension.
2. **Intent tokens** (`src/intent.js`). Privileged ops (`cookies.export`, `pwd.fill`, `pwd.save`, `page.extract`) require a 5s-TTL token. In MVP, tokens carry `hmac=null` — **the bridge daemon MUST refuse hmac=null tokens before any user-facing install ships**. The handshake op that wires up the real HMAC key is tracked separately in qdistro.

## Permissions

| Permission              | Why                                                      |
|-------------------------|----------------------------------------------------------|
| `nativeMessaging`       | the whole point — talks to the bridge                    |
| `tabs`, `activeTab`     | tabs.list across windows; popup needs the current tab    |
| `cookies`               | cookies.export                                           |
| `downloads`             | onChanged listener                                       |
| `notifications`         | show / receive notification events                       |
| `contextMenus`          | "Send to qdistro…" entry                                 |
| `contextualIdentities`  | Firefox-only containers module                           |
| `scripting`             | page.extract (selection capture)                         |
| `storage`               | options page                                             |
| `<all_urls>`            | cookies, page.extract work across origins                |

## Architecture

```
qdfirefox-extension/
├── manifest.json          # MV3 (background.scripts, gecko id)
├── src/
│   ├── api.js             # browser.* binding (Promise API)
│   ├── port.js            # connectNative + reconnect + heartbeat
│   ├── dispatcher.js      # request_id-correlated dispatch
│   ├── intent.js          # 5s TTL token mint
│   ├── background.js      # event-page entry
│   ├── popup.{html,js}    # toolbar action
│   ├── options.{html,js}  # storage-backed prefs
│   └── modules/
│       ├── tabs.js
│       ├── pwd.js
│       ├── pageExtract.js
│       ├── cookies.js
│       ├── containers.js  # Firefox-only
│       ├── mpris.js
│       ├── downloads.js
│       ├── notifications.js
│       └── screenlock.js
├── tests/
│   ├── helpers.js          # synthetic browser.* shim
│   └── *.test.js           # vitest suites
└── scripts/
    ├── build-extension.sh
    └── install-native-host.sh
```

## Wire protocol

Identical to qdchrome-extension. See `../qdchrome-extension/src/dispatcher.js` for the full shape. Summary:

- Inbound (bridge-initiated): `{op, request_id?, ...body}` → reply `{op: "<op>.reply", request_id, ok, ...body}`
- Outbound (extension-initiated): `qdistroDispatcher.request(op, body, {timeoutMs})` returns a Promise resolving with the bridge's reply.
- Heartbeat: bridge sends `qdistro.heartbeat`; port replies `qdistro.heartbeat.ack`. 60s watchdog tears down the port if missed.

The protocol is browser-agnostic; the same `qdistro-browser-bridge` daemon serves both Chromium and Firefox.
