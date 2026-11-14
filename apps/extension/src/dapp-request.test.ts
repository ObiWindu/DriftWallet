// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { approveWithGate, MemoryWebAuthnGate, type ApprovalEntry } from "./approval.js";
import {
  DappRequest,
  handleDappRequest,
  intentFromRequest,
  EIP155_METHODS,
} from "./dapp-request.js";

const ORIGIN = "https://app.uniswap.org";

describe("dapp-request — intent building", () => {
  it("eth_sendTransaction with value -> native-transfer intent", () => {
    const { intent } = intentFromRequest(DappRequest.parse({
      id: 1, origin: ORIGIN, method: "eth_sendTransaction",
      params: [{ from: "0xabc", to: "0xdef", value: "0xde0b6b3a7640000", data: "0x" }],
      chainId: "eip155:1",
    }));
    expect(intent).toMatchObject({
      kind: "native-transfer", amountBaseUnits: "1000000000000000000", dataHex: "0x", origin: ORIGIN,
    });
  });

  it("ERC-20 transfer data -> token-transfer", () => {
    const { intent } = intentFromRequest(DappRequest.parse({
      id: 2, origin: ORIGIN, method: "eth_sendTransaction",
      params: [{ to: "0xtoken", data: "0xa9059cbb" + "00".repeat(64) }],
    }));
    expect(intent.kind).toBe("token-transfer");
  });

  it("personal_sign keeps raw hex (policy blocks opaque)", () => {
    const { intent } = intentFromRequest(DappRequest.parse({
      id: 3, origin: ORIGIN, method: "personal_sign", params: ["0xdeadbeef"],
    }));
    expect(intent.dataHex).toBe("0xdeadbeef");
    expect(intent.kind).toBe("dapp-sign");
  });
});

describe("dapp-request — policy routing", () => {
  it("phishing origin -> deny entry, cannot be approved", async () => {
    const { queue, entry } = await handleDappRequest([], {
      id: 10, origin: "https://evil-drain.example", method: "eth_sendTransaction",
      params: [{ from: "0x1", to: "0x2", value: "0x1" }], chainId: "eip155:1",
    });
    expect(entry.verdict).toBe("deny");
    await expect(approveWithGate(queue, entry.id, new MemoryWebAuthnGate())).rejects.toThrow(/policy deny/);
  });

  it("unsupported method on eip155 -> rejected entry immediately", async () => {
    const { entry } = await handleDappRequest([], {
      id: 11, origin: ORIGIN, method: "solana_signTransaction", chainId: "eip155:1",
    });
    expect(entry.verdict).toBe("deny");
    expect(entry.decision).toBe("rejected");
    expect(entry.verdictReason).toMatch(/not allowed/);
    expect(EIP155_METHODS.has("personal_sign")).toBe(true);
    expect(EIP155_METHODS.has("solana_signTransaction")).toBe(false);
  });

  it("clean send with matching simulation -> allow entry", async () => {
    // value = 0x3e8 = 1000 wei, fee = 10 wei: claimed sender delta -1010, recipient +1000
    const simDiff = {
      balanceChanges: [
        { address: "0xabc", asset: "native", before: "1010", after: "0" },
        { address: "0xdef", asset: "native", before: "0", after: "1000" },
      ],
    };
    const { entry, queue } = await handleDappRequest([], {
      id: 12, origin: ORIGIN, method: "eth_sendTransaction",
      params: [{ from: "0xabc", to: "0xdef", value: "0x3e8" }], chainId: "eip155:1",
    }, {
      feeBaseUnits: "10",
      simulateEvm: async () => ({ stub: false, diff: simDiff }),
    });
    expect(entry.verdict).not.toBe("deny");
    expect(entry.verdictReason).not.toMatch(/simulation/i);
    expect(queue.find((e: ApprovalEntry) => e.id === entry.id)?.decision).toBe("pending");
  });

  it("simulation mismatch (recipient gets less than claimed) -> deny", async () => {
    const simDiff = {
      balanceChanges: [
        { address: "0xabc", asset: "native", before: "1010", after: "0" },
        { address: "0xdef", asset: "native", before: "0", after: "500" }, // claimed 1000, sim says 500
      ],
    };
    const { entry } = await handleDappRequest([], {
      id: 13, origin: ORIGIN, method: "eth_sendTransaction",
      params: [{ from: "0xabc", to: "0xdef", value: "0x3e8" }], chainId: "eip155:1",
    }, {
      feeBaseUnits: "10",
      simulateEvm: async () => ({ stub: false, diff: simDiff }),
    });
    expect(entry.verdict).toBe("deny");
    expect(entry.verdictReason).toMatch(/claimed delta|simulated/i);
  });

  it("simulation missing the claimed address -> deny", async () => {
    const { entry } = await handleDappRequest([], {
      id: 16, origin: ORIGIN, method: "eth_sendTransaction",
      params: [{ from: "0xabc", to: "0xdef", value: "0x3e8" }], chainId: "eip155:1",
    }, {
      simulateEvm: async () => ({ stub: false, diff: { balanceChanges: [{ address: "0xother", asset: "native", before: "1", after: "0" }] } }),
    });
    expect(entry.verdict).toBe("deny");
  });

  it("spending limit blocks high-value sends", async () => {
    const { entry } = await handleDappRequest([], {
      id: 14, origin: ORIGIN, method: "eth_sendTransaction",
      params: [{ from: "0xabc", to: "0xdef", value: "0x" + (5000n).toString(16) }], chainId: "eip155:1",
    }, { spentBaseUnits: "4000", spendLimitBaseUnits: "5000" });
    expect(entry.verdict).toBe("deny");
    expect(entry.verdictReason).toMatch(/limit/i);
  });

  it("typed-data domain mismatch -> stepUp", async () => {
    const { entry } = await handleDappRequest([], {
      id: 15, origin: ORIGIN, method: "eth_signTypedData_v4",
      params: ["0xabc", { domain: { name: "MetaMask", chainId: 1 }, message: {} }], chainId: "eip155:1",
    });
    expect(entry.verdict).toBe("stepUp");
  });
});
