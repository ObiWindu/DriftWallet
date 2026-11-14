// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Wallet UI state (SPEC §2: zustand). Headless vanilla store — React Native
// screens subscribe via `useStore` bindings in T009 shell; this module holds
// NO key material, only opaque sessionId + UI selection.
import { createStore } from "zustand/vanilla";

export const DEFAULT_AUTO_LOCK_MS = 5 * 60 * 1000;

export type LockState =
  | { status: "locked" }
  | { status: "unlocked"; sessionId: number; /** True when unlocked with the duress PIN (decoy vault). */
    duress?: boolean };

export interface WalletUiState {
  lock: LockState;
  selectedChain: string;
  autoLockMs: number;
  /** Iteration 3: watch-only accounts cannot sign (banner on every screen). */
  watchOnly: boolean;
  /** Iteration 3: per-session spending limit in USD cents ("0" = unlimited). */
  spendLimitUsdCents: string;
  unlock: (sessionId: number, opts?: { duress?: boolean }) => void;
  lockWallet: () => void;
  selectChain: (chainId: string) => void;
  setAutoLockMs: (ms: number) => void;
  setWatchOnly: (v: boolean) => void;
  setSpendLimitUsdCents: (cents: string) => void;
}

const ALLOWED_CHAINS = new Set([
  "eip155:1", "eip155:56", "eip155:137", "eip155:42161", "eip155:8453",
  "solana:mainnet",
  "bip122:000000000019d6689c085ae165831e93",
  "cardano:mainnet",
]);

export function createWalletStore() {
  return createStore<WalletUiState>()((set) => ({
    lock: { status: "locked" },
    selectedChain: "eip155:1",
    autoLockMs: DEFAULT_AUTO_LOCK_MS,
    watchOnly: false,
    spendLimitUsdCents: "0",
    unlock: (sessionId: number, opts?: { duress?: boolean }) => {
      if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error("bad session id");
      set({ lock: { status: "unlocked", sessionId, ...(opts?.duress ? { duress: true } : {}) } });
    },
    lockWallet: () => set({ lock: { status: "locked" } }),
    selectChain: (chainId: string) => {
      if (!ALLOWED_CHAINS.has(chainId)) throw new Error(`forbidden chain ${chainId}`);
      set({ selectedChain: chainId });
    },
    setAutoLockMs: (ms: number) => {
      if (!Number.isInteger(ms) || ms < 30_000 || ms > 30 * 60_000) {
        throw new Error("auto-lock must be 30s–30min");
      }
      set({ autoLockMs: ms });
    },
    setWatchOnly: (v: boolean) => set({ watchOnly: Boolean(v) }),
    setSpendLimitUsdCents: (cents: string) => {
      if (!/^\d+$/.test(cents)) throw new Error("spend limit must be integer cents");
      set({ spendLimitUsdCents: cents });
    },
  }));
}

export type WalletStore = ReturnType<typeof createWalletStore>;
