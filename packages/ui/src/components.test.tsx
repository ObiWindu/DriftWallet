// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import {
  AddressRow,
  Amount,
  BiometricGate,
  ChainBadge,
  FeePicker,
  PolicyBanner,
  chainLabel,
  createCopyTimer,
  feeTierOptions,
  quoteFeeBaseUnits,
  truncateAddressUi,
} from "./components.js";
import { chainBadge, truncateAddress } from "./index.js";

function staticText(c: unknown): string {
  if (typeof c === "string" || typeof c === "number") return String(c);
  if (Array.isArray(c)) return c.map(staticText).join("");
  if (c !== null && typeof c === "object" && "props" in c) {
    return staticText((c as { props: { children?: unknown } }).props.children);
  }
  return "";
}

function textOf(testID: string, root: TestRenderer.ReactTestInstance): string {
  const node = root.findByProps({ testID });
  return staticText((node.props as { children?: unknown }).children);
}

describe("components", () => {
  it("Amount renders bigint money with symbol and fiat", () => {
    let r: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <Amount value={1_500_000_000_000_000_000n} decimals={18} symbol="ETH" fiat="$3000.00" />,
      );
    });
    expect(textOf("amount-value", r!.root)).toBe("1.5 ETH");
    expect(textOf("amount-fiat", r!.root)).toBe("$3000.00");
  });

  it("Amount renders 1 wei exactly (no float dust)", () => {
    let r: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Amount value={1n} decimals={18} symbol="ETH" />);
    });
    expect(textOf("amount-value", r!.root)).toBe("0.000000000000000001 ETH");
  });

  it("AddressRow truncates and fires copy", () => {
    const onCopy = vi.fn();
    let r: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<AddressRow address="0x1234567890abcdef1234" onCopy={onCopy} />);
    });
    expect(textOf("address-text", r!.root)).toBe(truncateAddressUi("0x1234567890abcdef1234"));
    act(() => {
      r!.root.findByProps({ testID: "address-copy" }).props.onPress();
    });
    expect(onCopy).toHaveBeenCalledWith("0x1234567890abcdef1234");
    expect(textOf("address-copy", r!.root)).toContain("Copied");
  });

  it("copy timer auto-clears and is cancellable", async () => {
    const onClear = vi.fn();
    const timer = createCopyTimer(15, onClear);
    timer.notifyCopied();
    timer.notifyCopied(); // re-arm resets the deadline
    await new Promise((res) => setTimeout(res, 40));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(() => createCopyTimer(0, onClear)).toThrow();
    const t2 = createCopyTimer(10, onClear);
    t2.notifyCopied();
    t2.cancel();
    await new Promise((res) => setTimeout(res, 30));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("ChainBadge extends chainBadge with testnets", () => {
    expect(chainBadge("eip155:1")).toBe("Ethereum"); // legacy helper untouched
    expect(truncateAddress("0x1234567890abcdef")).toBe("0x1234…cdef");
    expect(chainLabel("eip155:1")).toBe("Ethereum");
    expect(chainLabel("eip155:11155111")).toBe("Sepolia");
    expect(chainLabel("solana:devnet")).toBe("Solana Devnet");
    expect(chainLabel("mystery:9")).toBe("mystery:9");
    let r: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<ChainBadge chainId="cardano:preprod" />);
    });
    expect(textOf("chain-badge-label", r!.root)).toBe("Cardano Preprod");
  });

  it("FeePicker quotes bigint-exact tiers with fiat", () => {
    expect(quoteFeeBaseUnits(1000n, "low")).toBe(800n);
    expect(quoteFeeBaseUnits(1000n, "med")).toBe(1000n);
    expect(quoteFeeBaseUnits(1000n, "high")).toBe(1500n);
    expect(quoteFeeBaseUnits(1001n, "low")).toBe(801n); // ceil, never rounds to zero fee
    expect(quoteFeeBaseUnits(1n, "low")).toBe(1n);
    expect(() => quoteFeeBaseUnits(-1n, "med")).toThrow();
    const opts = feeTierOptions(1_000_000n, 9, 200_000n); // 0.001 @ $2000 = $2.00
    expect(opts.map((o) => o.level)).toEqual(["low", "med", "high"]);
    expect(opts[1]?.fiat).toBe("$2.00");
    const onSelect = vi.fn();
    let r: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<FeePicker options={opts} selected="med" onSelect={onSelect} />);
    });
    act(() => {
      r!.root.findByProps({ testID: "fee-high" }).props.onPress();
    });
    expect(onSelect).toHaveBeenCalledWith("high");
  });

  it("PolicyBanner maps allow/warn/block verdicts", () => {
    for (const verdict of ["allow", "warn", "block"] as const) {
      let r: TestRenderer.ReactTestRenderer;
      act(() => {
        r = TestRenderer.create(
          <PolicyBanner
            verdict={verdict}
            findings={[{ severity: "warn", code: "HIGH_FEE", message: "fee > 5%" }]}
          />,
        );
      });
      expect(r!.root.findByProps({ testID: `policy-${verdict}` })).toBeDefined();
      expect(textOf("policy-finding-HIGH_FEE", r!.root)).toBe("fee > 5%");
    }
  });

  it("BiometricGate passes through when not required or authenticated", () => {
    const onAuth = vi.fn();
    for (const props of [
      { required: false, authenticated: false },
      { required: true, authenticated: true },
    ] as const) {
      let r: TestRenderer.ReactTestRenderer;
      act(() => {
        r = TestRenderer.create(
          <BiometricGate required={props.required} authenticated={props.authenticated} onAuthenticate={onAuth} />,
        );
      });
      expect(r!.root.findAllByProps({ testID: "biometric-auth" }).length).toBe(0);
    }
    let r: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<BiometricGate required authenticated={false} onAuthenticate={onAuth} />);
    });
    expect(r!.root.findAllByProps({ testID: "biometric-auth" }).length).toBe(1);
    act(() => {
      r!.root.findByProps({ testID: "biometric-auth" }).props.onPress();
    });
    expect(onAuth).toHaveBeenCalledTimes(1);
  });
});
