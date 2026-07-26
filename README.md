# qdfirefox-extension

Firefox MV3 WebExtension — native-messaging client for the qdistro browser bridge. Peer of [qdchrome-extension](../qdchrome-extension); same wire protocol, different host environment.

## Role in qdistro

This repo is the Firefox-native browser adapter for qdistro. It connects Firefox
to the qdistro browser bridge so tabs, page extraction, password-vault requests,
media status, downloads, notifications, cookies, and screen-lock inhibition can
be mediated by qdistro policy.

Firefox containers/contextual identities are the reason this remains a separate
subrepo instead of a build target of qdchrome-extension. Containers map naturally
onto qdistro's silo/session model and let browser state carry a stronger
context boundary than a plain profile alone.

## Why a separate repo

qdchrome-extension used to build a Firefox MV2 xpi (concatenated bundle, `chrome.*` callback API); that target was removed, and this repo is now the *only* source of the qdistro Firefox extension. It is Firefox-native:

- **MV3** (`browser.scripts` event page, not the deprecated MV2 background page)
- **`browser.*` Promise API** throughout — no callback-shim
- **First-class containers / contextual identities** — the load-bearing reason this is a separate codebase rather than a build target

## Status

In development, tracking the v1 bridge op set. The module table below is the
intended surface; the vitest suite (see [Test](#test)) and the cross-repo
golden-frame contract tests are the source of truth for what is covered.

| Module           | Direction        | Ops                                                 |
|------------------|------------------|-----------------------------------------------------|
| `tabs`           | bridge → ext     | `tabs.list`, `tabs.open`, `tabs.close`              |
| `pwd`            | ext → bridge     | `pwd.fill`, `pwd.save` (driven by `pwd-content.js`) |
| `pageExtract`    | ext → bridge     | `page.extract`                                      |
| `cookies`        | ext → bridge     | `cookies.export` (intent token)                     |
| `containers`     | bridge → ext     | `containers.list`, `containers.create`, `containers.remove` (Firefox-only) |
| `mpris`          | both             | `mpris.update`, `mpris.control` (driven by `mpris-content.js`) |
| `downloads`      | ext → bridge     | `downloads.update`                                  |
| `notifications`  | bridge → ext     | `notifications.show`                                |
| `screenlock`     | ext → bridge     | `screenlock.inhibit`, `screenlock.release` (driven by `screenlock-content.js`) |

`tabs.open` accepts `cookie_store_id` to pin the new tab to a container; `cookies.export` accepts the same field to scope the export.

Security-sensitive flows are still being aligned with the current qdistro
browser model. Password fill/save, cookie export, and page extraction should be
treated as privileged bridge operations requiring trusted UI and bridge policy
before any user-facing install ships.

### Content scripts

Injected at `document_idle` on `<all_urls>`.

- `pwd-content.js` — on `<input type=password>` focus: queries the bridge for credentials, auto-fills if exactly one match, renders a minimal picker otherwise. On `<form>` submit with a changed password: forwards to `pwd.save`.
- `mpris-content.js` — 1Hz poll of `navigator.mediaSession.metadata` + `playbackState`, plus event-driven updates on `play`/`pause`/`ended`. Reports to the bridge as `mpris.update`. Receives `mpris.do_action` from the bridge and translates to `HTMLMediaElement.play()`/`.pause()` / `.currentTime`.
- `screenlock-content.js` — `fullscreenchange` listener. Inhibits the screen lock on fullscreen entry (classified as `fullscreen_video` if a playing `<video>` is inside, else `fullscreen_presentation`); releases on exit or `pagehide`. Background event page reference-counts per tab and releases on `tabs.onRemoved`.

## Build

```bash
npm install
npm run build
# → dist/firefox/      unpacked tree (use about:debugging "Load Temporary Add-on")
# → dist/firefox.xpi   packed for AMO submission / signed install

# AMO-sign the xpi (unlisted channel). Requires WEB_EXT_API_KEY and
# WEB_EXT_API_SECRET in the env and the `web-ext` CLI on PATH; without
# them the flag warns and skips. Emits dist/firefox-signed.xpi
# alongside the unsigned xpi.
WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... bash scripts/build-extension.sh --sign
```

## Test

```bash
npm test
```

Vitest. Most suites load the source files into a synthetic `self` global with
a `browser.*` Promise-API shim — same shape as qdchrome-extension's helpers;
DOM-facing suites (popup, options, content scripts) opt into jsdom via
`@vitest-environment` pragmas. The two extension repos are developed in
lockstep and share cross-repo "golden frame" wire-contract tests.

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
| `tabs`                  | tabs.list across windows                                 |
| `cookies`               | cookies.export                                           |
| `downloads`             | onChanged listener                                       |
| `notifications`         | show / receive notification events                       |
| `contextMenus`          | "Send to qdistro…" entry                                 |
| `contextualIdentities`  | Firefox-only containers module                           |
| `scripting`             | page.extract (selection capture)                         |
| `storage`               | options page                                             |
| `<all_urls>`            | cookies, page.extract work across origins                |

The set is pinned minimal for the frozen v1 op set (closed-set test in
`tests/manifest.test.js`). `activeTab` (redundant with `<all_urls>` +
`tabs`) and `webNavigation` (no navigation listener in `src/`) were dropped
under S8 P0-5; new permissions require updating the test after a security
review.

Firefox MV3 treats `host_permissions` as user-controllable origin grants;
the extension assumes the `<all_urls>` grant is in effect (the supported
deployment installs it via enterprise `force_installed` policy). Without it,
the static content scripts and the context-menu `page.extract` path do not
function — there is no narrower fallback, by design.

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
