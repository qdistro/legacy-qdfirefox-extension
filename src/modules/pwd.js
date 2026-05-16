// pwd module.
//
// Two extension-initiated flows:
//
//   - pwd.fill: on focus of <input type="password">, a content script
//     messages the background which calls
//     qdistroDispatcher.request("pwd.fill", {url, username?, intent_token}).
//     Bridge replies `{credentials: [...]}` or `{error: ...}`.
//
//   - pwd.save: on form submit with new credentials, same path with
//     `{url, username, password, intent_token}`.
//
// No bridge-initiated direction — fills are always user-initiated.
// Intent token is opaque here; intent.js mints it.
//
// @ts-check
(function (root) {
  "use strict";
  const dispatcher = root.qdistroDispatcher;

  async function fill(url, username, intentToken) {
    return await dispatcher.request("pwd.fill", {
      url, username: username || null, intent_token: intentToken,
    });
  }

  async function save(url, username, password, intentToken) {
    return await dispatcher.request("pwd.save", {
      url, username, password, intent_token: intentToken,
    });
  }

  root.qdistroPwd = { fill, save };
})(typeof self !== "undefined" ? self : globalThis);
