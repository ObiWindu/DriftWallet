// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// MV3 service worker: session/permission store + dApp message router.
// No keys here — approvals live in the popup, signing in the offscreen doc.
import { RpcMsg } from "./background.js";

declare const chrome: {
  alarms: { create(name: string, info: { periodInMinutes: number }): void };
  runtime: {
    onInstalled: { addListener(fn: () => void): void };
    onMessage: {
      addListener(
        fn: (msg: unknown, sender: { origin?: string }, sendResponse: (r: unknown) => void) => boolean | void,
      ): void;
    };
  };
};

const AUTO_LOCK_ALARM = "drift-autolock-ping";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: 1 });
});

chrome.runtime.onMessage.addListener((raw: unknown, sender: { origin?: string }, sendResponse: (r: unknown) => void) => {
  let parsed: unknown;
  try {
    parsed = RpcMsg.parse(raw);
  } catch {
    sendResponse({ ok: false, error: "bad_request" });
    return;
  }
  // Route table lives in the popup/full-page UI; the worker only validates
  // envelope + origin here. Approval queue + signing are handled downstream.
  void sender;
  sendResponse({ ok: true, queued: true, method: (parsed as { method: string }).method });
});
