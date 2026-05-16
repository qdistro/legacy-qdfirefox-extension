# 07 — UI/glue coverage (background, popup, options, content scripts)

## Gap

`tests/helpers.js` evals the IIFE modules from `src/` and `src/modules/` into a synthetic `self` global. Five files have zero coverage:

- `src/background.js` — event-page boot, `runtime.onMessage` listener (status/ping/cookies.export/containers.list/content-script handlers).
- `src/popup.js` — toolbar action UI logic.
- `src/options.js` — preferences page UI logic.
- `src/content/pwd-content.js` — autofill content script (added in [03]).
- `src/content/mpris-content.js` — media observer content script (added in [04]).
- `src/content/screenlock-content.js` — fullscreen observer content script (added in [05]).

That's ~500 LOC of glue with no behavioral pin.

## Plan

1. **`happy-dom` for DOM** — lighter than jsdom; vitest supports it as the `environment` option per-file. `// @vitest-environment happy-dom` at the top of each UI test.
2. **Background.js harness extension** — `helpers.js` gets a `loadBackground()` that additionally evals `src/background.js`. The synthetic `browser.runtime.onMessage.addListener` becomes a stub that records the registered listener so tests can fire synthetic `runtime.sendMessage` calls.
3. **Popup/options harness** — `loadPopupDom(htmlPath)`. Reads the HTML, parses into happy-dom, then evals `popup.js` against the resulting `document`. Tests assert on `document.getElementById("status").textContent` etc.
4. **Content-script harness** — same shape, but the synthetic `browser.runtime.sendMessage` records outbound messages so tests can assert what the content script tried to send the background.

## What to cover, in priority order

| File | Cases |
|---|---|
| `background.js` | sender-id check rejects foreign senders; `status` returns connected/disconnected; `ping` routes through dispatcher; `cookies.export` mints intent + scopes to `cookie_store_id`; `containers.list` returns shape; content-script `pwd.request_fill` mints + forwards |
| `popup.js` | status renders connected/disconnected with correct color class; Ping button triggers send; Container picker populates from `contextualIdentities.query`; cookies-export passes the picked store id |
| `options.js` | load from storage hydrates checkboxes + textarea; save persists shape `{modules, origin_allowlist}` |
| `content/pwd-content.js` | password-input focus fires `pwd.request_fill`; reply with single credential fills value; reply with multiple shows picker overlay; form submit fires `pwd.request_save` only when password changed |
| `content/mpris-content.js` | metadata change fires `mpris.report_update`; bridge-side `mpris.do_action` invokes mediaSession action |
| `content/screenlock-content.js` | `fullscreenchange` to fullscreen fires `screenlock.report_inhibit`; back to non-fullscreen fires `report_release`; `pagehide` fires release |

## Non-goals for this track

- Visual regression / pixel diff. That's the integration corpus, not vitest.
- Real Firefox process startup. `web-ext run` is for the integration corpus.
- Coverage of `tests/integration/firefox-gui/*.md` — those are agent-driven and have their own assertion model.

## See also

- Sibling track at `../../qdchrome-extension/todo/04-ui-tests.md` — same gap, mirrored fix. Whichever lands first should publish the harness extension; the other repo can copy it.
