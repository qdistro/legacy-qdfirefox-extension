// Intent token minting.
//
// Per qdistro spec/14 Phase-9d: tokens are
// {operation, timestamp, ttl_ms, nonce, hmac} with HMAC key shared
// between extension and daemon via `qdistro.handshake`. Token TTL
// 5 seconds; scope is a single request-id.
//
// MVP: handshake not yet wired on the bridge side, so we mint
// unsigned tokens. The daemon-side verification will reject these
// once the handshake op lands — which is the intended posture.
//
// @ts-check
(function (root) {
  "use strict";

  const TTL_MS = 5000;
  let counter = 0;
  let sessionSecret = null;

  function mint(operation, ttlMs) {
    ttlMs = ttlMs || TTL_MS;
    counter += 1;
    return {
      operation: String(operation || ""),
      timestamp: Date.now(),
      ttl_ms: ttlMs,
      nonce: `${counter}-${Math.random().toString(36).slice(2, 10)}`,
      hmac: sessionSecret ? hmacPlaceholder() : null,
    };
  }

  function hmacPlaceholder() {
    // Real HMAC will use crypto.subtle once the handshake establishes
    // sessionSecret. Until then, intent tokens carry hmac=null and
    // the bridge rejects them — intended posture.
    return null;
  }

  function setSessionSecret(secret) {
    sessionSecret = secret || null;
  }

  function ttlMs() { return TTL_MS; }

  root.qdistroIntent = { mint, setSessionSecret, ttlMs };
})(typeof self !== "undefined" ? self : globalThis);
