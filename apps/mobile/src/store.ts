// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Wallet UI state (SPEC §2: zustand). Headless vanilla store — React Native
// screens subscribe via `useStore` bindings in T009 shell; this module holds
// NO key material, only opaque sessionId + UI selection.
import { createStore } from "zustand/vanilla";

export const BIOMETRIC_THRESHOLD_USD = 100;
export const DEFAULT_AUTO_LOCK_MS = 5 * 60 * 1000;

export type LockState =
  | { status: "locked" }
  | { status: "unlocked"; sessionId: number };

export interface WalletUiState {
  lock: LockState;
  selectedChain: string;
  autoLockMs: number;
  unlock: (sessionId: number) => void;
  lockWallet: () => void;
  selectChain: (chainId: string) => void;
  setAutoLockMs: (ms: number) => void;
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
    unlock: (sessionId: number) => {
      if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error("bad session id");
      set({ lock: { status: "unlocked", sessionId } });
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
  }));
}

export type WalletStore = ReturnType<typeof createWalletStore>;
