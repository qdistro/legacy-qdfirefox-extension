// pwd autofill content-script.
//
// Wired in manifest.json via `content_scripts` at document_idle on
// <all_urls>. Talks to the background event page via
// browser.runtime.sendMessage; never owns a native-messaging port
// (only the background does — one port per session, per spec/14).
//
// Flow:
//
//   1. Listen for `focus` on <input type="password">.
//   2. Send {kind: "pwd.request_fill", url, username?} to background.
//   3. Background mints an intent token, calls qdistroPwd.fill,
//      replies with {ok:true, credentials:[{username,password}, ...]}.
//   4. If exactly one credential: fill the password input (and the
//      preceding username input if we can find one). Else, render
//      a minimal credential-picker overlay anchored to the input.
//   5. Listen for `submit` on the surrounding <form>. If the
//      password differs from the last filled value (or we didn't
//      fill anything), send {kind: "pwd.request_save", url,
//      username, password} to background.
//
// Open items tracked in todo/03-pwd-content-script.md (cross-frame
// support, shadow-DOM picker, save-prompt UX, phishing surface).
//
// @ts-check
(function () {
  "use strict";
  const api = (typeof browser !== "undefined") ? browser : chrome;
  if (!api || !api.runtime) return;

  // Track the most recent fill so we can decide whether `submit`
  // actually carries new credentials worth saving.
  let lastFilledValue = null;
  let lastFilledFor = null; // password input element

  function log(...args) {
    try { console.debug("[qdistro/pwd-content]", ...args); } catch (_) {}
  }

  function findUsernameInput(passwordInput) {
    // The username field is typically a text/email input above the
    // password input in the same form. Walk backward through form
    // controls; pick the first text-like input that isn't the
    // password one.
    const form = passwordInput.form;
    if (!form) return null;
    const inputs = Array.from(form.elements);
    const passIdx = inputs.indexOf(passwordInput);
    for (let i = passIdx - 1; i >= 0; i--) {
      const el = inputs[i];
      if (!(el instanceof HTMLInputElement)) continue;
      const t = (el.type || "text").toLowerCase();
      if (t === "text" || t === "email" || t === "tel" || t === "" || t === "username") {
        return el;
      }
    }
    return null;
  }

  function fillCredential(passwordInput, cred) {
    const usernameInput = findUsernameInput(passwordInput);
    if (usernameInput && cred.username) {
      usernameInput.value = cred.username;
      usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
      usernameInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    passwordInput.value = cred.password || "";
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    passwordInput.dispatchEvent(new Event("change", { bubbles: true }));
    lastFilledValue = passwordInput.value;
    lastFilledFor = passwordInput;
  }

  function removePicker() {
    const old = document.getElementById("qdistro-pwd-picker");
    if (old) old.remove();
  }

  function renderPicker(passwordInput, credentials) {
    removePicker();
    const rect = passwordInput.getBoundingClientRect();
    const box = document.createElement("div");
    box.id = "qdistro-pwd-picker";
    Object.assign(box.style, {
      position: "fixed",
      top: `${rect.bottom + 2}px`,
      left: `${rect.left}px`,
      minWidth: `${rect.width}px`,
      background: "#fff",
      color: "#000",
      border: "1px solid #888",
      borderRadius: "4px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      font: "12px sans-serif",
      zIndex: "2147483647",
      maxHeight: "200px",
      overflow: "auto",
    });
    for (const cred of credentials) {
      const row = document.createElement("div");
      row.textContent = cred.username || "(no username)";
      Object.assign(row.style, {
        padding: "6px 10px", cursor: "pointer",
      });
      row.addEventListener("mouseenter", () => { row.style.background = "#eef"; });
      row.addEventListener("mouseleave", () => { row.style.background = "#fff"; });
      row.addEventListener("mousedown", (e) => {
        e.preventDefault(); // don't blur the password input
        fillCredential(passwordInput, cred);
        removePicker();
      });
      box.appendChild(row);
    }
    document.body.appendChild(box);
    // Close on click outside.
    setTimeout(() => {
      document.addEventListener("mousedown", function onOutside(e) {
        if (!box.contains(e.target)) {
          removePicker();
          document.removeEventListener("mousedown", onOutside);
        }
      });
    }, 0);
  }

  async function onPasswordFocus(ev) {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.type !== "password") return;
    log("password focus", location.href);
    try {
      const usernameInput = findUsernameInput(el);
      const resp = await api.runtime.sendMessage({
        kind: "pwd.request_fill",
        url: location.href,
        username: usernameInput ? usernameInput.value || null : null,
      });
      if (!resp || !resp.ok) return;
      const creds = (resp.response && resp.response.credentials) || [];
      if (creds.length === 0) return;
      if (creds.length === 1) {
        fillCredential(el, creds[0]);
      } else {
        renderPicker(el, creds);
      }
    } catch (e) {
      log("fill failed", e && e.message);
    }
  }

  function onSubmit(ev) {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement)) return;
    const passwordInput = Array.from(form.elements).find(
      (el) => el instanceof HTMLInputElement && el.type === "password");
    if (!passwordInput || !passwordInput.value) return;
    // Only save if the value differs from what we filled (or we
    // never filled anything in this input). Otherwise the bridge
    // would see a save request every successful login.
    if (lastFilledFor === passwordInput && lastFilledValue === passwordInput.value) {
      return;
    }
    const usernameInput = findUsernameInput(passwordInput);
    const payload = {
      kind: "pwd.request_save",
      url: location.href,
      username: usernameInput ? usernameInput.value || null : null,
      password: passwordInput.value,
    };
    api.runtime.sendMessage(payload).catch((e) => {
      log("save failed", e && e.message);
    });
  }

  document.addEventListener("focus", onPasswordFocus, true);
  document.addEventListener("submit", onSubmit, true);
  log("pwd content-script loaded");
})();
