// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Content-script bundle entry: injects provider shims, relays dApp messages.
// Runs in the isolated world; never touches wallet secrets.
import { buildInjectedScript } from "./injected.js";
import { isRelayableOrigin, relayToBackground } from "./content-script.js";

declare const chrome: {
  runtime: { sendMessage(msg: unknown): void };
};

function inject(): void {
  const el = document.createElement("script");
  el.textContent = buildInjectedScript();
  (document.head ?? document.documentElement).appendChild(el);
  el.remove();
}

function listen(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    if (!isRelayableOrigin(window.location.origin)) return;
    try {
      const envelope = relayToBackground(event.data);
      chrome.runtime.sendMessage(envelope);
    } catch {
      // Invalid or unrelayable payloads are dropped silently.
    }
  });
}

inject();
listen();
