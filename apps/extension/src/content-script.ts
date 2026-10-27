// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Content-script: verifies origin, forwards RpcMsg to background SW.
// Runs in the page's isolated world; never touches wallet secrets.
import { RpcMsg } from "./background.js";

export const RELAY = true;

/** Reject opaque origins and non-http(s) pages (e.g. file://, data:). */
export function isRelayableOrigin(origin: string): boolean {
  if (origin === "null") return false;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export interface RelayEnvelope {
  direction: "dapp->background";
  msg: RpcMsg;
}

/** Validate + wrap a raw window.postMessage payload for chrome.runtime relay. */
export function relayToBackground(raw: unknown): RelayEnvelope {
  const msg = RpcMsg.parse(raw);
  if (!isRelayableOrigin(msg.origin)) throw new Error(`unrelayable origin: ${msg.origin}`);
  return { direction: "dapp->background", msg };
}
