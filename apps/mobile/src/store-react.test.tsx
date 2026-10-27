// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import { createUseWalletStore } from "./store-react.js";
import { createWalletStore } from "./store.js";

describe("store-react bindings (no key material)", () => {
  it("subscribes to the whole store and re-renders on unlock", () => {
    const store = createWalletStore();
    const useWalletStore = createUseWalletStore(store);
    const seen: string[] = [];
    function Probe() {
      const s = useWalletStore();
      seen.push(s.lock.status);
      return null;
    }
    let r: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Probe />);
    });
    expect(seen).toEqual(["locked"]);
    act(() => {
      store.getState().unlock(7);
    });
    expect(seen).toEqual(["locked", "unlocked"]);
    expect(store.getState().lock).toEqual({ status: "unlocked", sessionId: 7 });
    act(() => {
      r!.unmount();
    });
  });

  it("selector variant memoizes and updates on relevant change", () => {
    const store = createWalletStore();
    const useWalletStore = createUseWalletStore(store);
    const seen: string[] = [];
    function Probe() {
      const chain = useWalletStore((s) => s.selectedChain);
      seen.push(chain);
      return null;
    }
    act(() => {
      TestRenderer.create(<Probe />);
    });
    expect(seen).toEqual(["eip155:1"]);
    act(() => {
      store.getState().selectChain("solana:mainnet");
    });
    expect(seen[seen.length - 1]).toBe("solana:mainnet");
  });

  it("vanilla store contract still holds (no key material)", () => {
    const store = createWalletStore();
    const keys = Object.keys(store.getState().lock);
    expect(keys).toEqual(["status"]);
    store.getState().unlock(42);
    const state = JSON.stringify(store.getState());
    expect(state).not.toMatch(/mnemonic|seed|private|secret|password/i);
    expect(state).toContain("42");
  });
});
