// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { useRef } from "react";
import { useSyncExternalStore } from "react";
import type { WalletStore, WalletUiState } from "./store.js";

// React bindings for the vanilla wallet store (U002).
// `store.ts` stays framework-free; these hooks are the only React entry.
// No key material flows here — the store holds an opaque sessionId only.

export interface UseWalletStore {
  (): WalletUiState;
  <T>(selector: (s: WalletUiState) => T): T;
}

export function createUseWalletStore(store: WalletStore): UseWalletStore {
  function useWalletStore(): WalletUiState;
  function useWalletStore<T>(selector: (s: WalletUiState) => T): T;
  function useWalletStore<T>(selector?: (s: WalletUiState) => T): WalletUiState | T {
    const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
    const cache = useRef<{ state: WalletUiState; selected: unknown } | null>(null);
    if (selector === undefined) return state;
    if (cache.current === null || cache.current.state !== state) {
      cache.current = { state, selected: selector(state) };
    }
    return cache.current.selected as T;
  }
  return useWalletStore;
}
