// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  checkAddressPoison,
  checkDangerousSelector,
  checkEip712Domain,
  checkFeeSanity,
  checkSpendingLimit,
  compareDeltas,
  compareSimulation,
  evaluate,
  isPhishingDomain,
  simulateEvm,
  simulateSolana,
} from "./index.js";

describe("policy-engine", () => {
  it("blocks phishing", async () => {
    const v = await evaluate({
      chainId: "eip155:1", kind: "native-transfer", from: "0x1", to: "0x2",
      amountBaseUnits: "1000", feeBaseUnits: "10", origin: "https://evil-drain.example",
    });
    expect(v.verdict).toBe("block");
  });
  it("warns infinite allowance", async () => {
    const maxHex = ((1n << 256n) - 1n).toString(16).padStart(64, "0");
    const v = await evaluate({
      chainId: "eip155:1", kind: "token-transfer", from: "0x1", to: "0x2",
      amountBaseUnits: "0", feeBaseUnits: "10",
      dataHex: `0x095ea7b3${"00".repeat(32)}${maxHex}`, origin: "https://app.uniswap.org",
    });
    expect(v.verdict).toBe("warn");
  });
  it("blocks opaque sign", async () => {
    const v = await evaluate({
      chainId: "eip155:1", kind: "dapp-sign", from: "0x1", to: "0x1",
      amountBaseUnits: "0", feeBaseUnits: "0", origin: "https://app.example",
    });
    expect(v.verdict).toBe("block");
  });
  it("allows clean transfer", async () => {
    const v = await evaluate({
      chainId: "eip155:1", kind: "native-transfer", from: "0x1", to: "0x2",
      amountBaseUnits: "1000000", feeBaseUnits: "1000", origin: "https://app.uniswap.org",
    });
    expect(v.verdict).toBe("allow");
  });
  it("warns address poison on first4/last4 collision", async () => {
    const legit = "0x1234567890abcdef1234567890abcdef12345678";
    const poison = "0x1234ffffffffffeeeeeeeeeeeeeeeeeeeeeeee5678";
    expect(checkAddressPoison([legit], poison)?.code).toBe("ADDRESS_POISON");
    expect(checkAddressPoison([legit], legit)).toBeNull();
    expect(checkAddressPoison([legit], "0x9999aaaa0000bbbb11112222333344445555cccc")).toBeNull();
    const v = await evaluate(
      {
        chainId: "eip155:1", kind: "native-transfer", from: "0x1", to: poison,
        amountBaseUnits: "1000000", feeBaseUnits: "1000", origin: "https://app.uniswap.org",
      },
      { history: [legit] },
    );
    expect(v.verdict).toBe("warn");
    expect(v.findings.some((f) => f.code === "ADDRESS_POISON")).toBe(true);
  });
  it("warns fee sanity fiat + percent", async () => {
    expect(checkFeeSanity("1000", "100")?.code).toBe("HIGH_FEE");
    expect(checkFeeSanity("1000000", "1000", { feeUsd: 60 })?.code).toBe("HIGH_FEE_FIAT");
    expect(checkFeeSanity("1000000", "1000")).toBeNull();
    const v = await evaluate(
      {
        chainId: "eip155:1", kind: "native-transfer", from: "0x1", to: "0x2",
        amountBaseUnits: "1000000", feeBaseUnits: "1000", origin: "https://app.uniswap.org",
      },
      { feeFiatUsd: 75 },
    );
    expect(v.verdict).toBe("warn");
  });
  it("simulate stubs + block on mismatch", async () => {
    const intent = {
      chainId: "eip155:1", kind: "native-transfer" as const, from: "0xabc", to: "0xdef",
      amountBaseUnits: "100000", feeBaseUnits: "100", origin: "https://app.uniswap.org",
    };
    const evm = await simulateEvm(intent);
    const sol = await simulateSolana(intent);
    expect(evm.length).toBe(1);
    expect(sol.length).toBe(1);
    expect(compareSimulation(evm, evm)).toBeNull();
    const tampered = [{ ...evm[0]!, delta: "-999" as string, address: evm[0]!.address, token: evm[0]!.token, before: evm[0]!.before, after: evm[0]!.after }];
    expect(compareSimulation(tampered, evm)?.code).toBe("SIM_MISMATCH");
    const v = await evaluate(intent, { claimed: tampered, simulated: evm });
    expect(v.verdict).toBe("block");
    const ok = await evaluate(intent, { claimed: evm, simulated: evm });
    expect(ok.verdict).toBe("allow");
  });
  it("simulation match emits SIM_OK", async () => {
    const intent = {
      chainId: "eip155:1", kind: "native-transfer" as const, from: "0xabc", to: "0xdef",
      amountBaseUnits: "100000", feeBaseUnits: "100", origin: "https://app.uniswap.org",
    };
    const sim = await simulateEvm(intent);
    const v = await evaluate(intent, { claimed: sim, simulated: sim });
    expect(v.verdict).toBe("allow");
    expect(v.findings.some((f) => f.code === "SIM_OK" && f.severity === "info")).toBe(true);
  });
  it("simulation mismatch blocks SIM_MISMATCH", async () => {
    const intent = {
      chainId: "eip155:1", kind: "native-transfer" as const, from: "0xabc", to: "0xdef",
      amountBaseUnits: "100000", feeBaseUnits: "100", origin: "https://app.uniswap.org",
    };
    const sim = await simulateEvm(intent);
    const tampered = [{ ...sim[0]!, delta: "-1" }];
    const v = await evaluate(intent, { claimed: tampered, simulated: sim });
    expect(v.verdict).toBe("block");
    expect(v.findings.some((f) => f.code === "SIM_MISMATCH" && f.severity === "block")).toBe(true);
  });
  it("stub simulation (null) allows with SIM_UNAVAILABLE", async () => {
    const intent = {
      chainId: "eip155:1", kind: "native-transfer" as const, from: "0xabc", to: "0xdef",
      amountBaseUnits: "100000", feeBaseUnits: "100", origin: "https://app.uniswap.org",
    };
    const sim = await simulateEvm(intent);
    const tampered = [{ ...sim[0]!, delta: "-1" }];
    // even a mismatching claim must not block when simulation is unavailable
    const v = await evaluate(intent, { claimed: tampered, simulated: null });
    expect(v.verdict).toBe("allow");
    expect(v.findings.some((f) => f.code === "SIM_UNAVAILABLE" && f.severity === "info")).toBe(true);
    const v2 = await evaluate(intent, { simulated: null });
    expect(v2.verdict).toBe("allow");
    expect(v2.findings.some((f) => f.code === "SIM_UNAVAILABLE")).toBe(true);
  });
  it("tolerance boundary: dust allowed, excess blocked", async () => {
    const intent = {
      chainId: "eip155:1", kind: "native-transfer" as const, from: "0xabc", to: "0xdef",
      amountBaseUnits: "100000", feeBaseUnits: "100", origin: "https://app.uniswap.org",
    };
    const sim = await simulateEvm(intent);
    const base = sim[0]!;
    const offByOne = [{ ...base, after: (BigInt(base.after) + 1n).toString(), delta: (BigInt(base.delta) + 1n).toString() }];
    // compareSimulation directly
    expect(compareSimulation(offByOne, sim, 1n)).toBeNull();
    expect(compareSimulation(offByOne, sim, 0n)?.code).toBe("SIM_MISMATCH");
    // via evaluate with tolerance
    const allowed = await evaluate(intent, { claimed: offByOne, simulated: sim, tolerance: 1n });
    expect(allowed.verdict).toBe("allow");
    expect(allowed.findings.some((f) => f.code === "SIM_OK")).toBe(true);
    const blocked = await evaluate(intent, { claimed: offByOne, simulated: sim, tolerance: 0n });
    expect(blocked.verdict).toBe("block");
    expect(blocked.findings.some((f) => f.code === "SIM_MISMATCH")).toBe(true);
  });
});

describe("policy-engine iteration 3 — limits, domains, selectors, dynamic phish", () => {
  const baseIntent = {
    chainId: "eip155:1", kind: "native-transfer" as const, from: "0x1", to: "0x2",
    amountBaseUnits: "1000", feeBaseUnits: "10", origin: "https://app.uniswap.org",
  };

  it("dynamic phish list extends the built-in one", () => {
    expect(isPhishingDomain("https://new-scam.example")).toBe(false);
    expect(isPhishingDomain("https://new-scam.example", ["new-scam.example"])).toBe(true);
    expect(isPhishingDomain("https://sub.new-scam.example", ["new-scam.example"])).toBe(true);
    expect(isPhishingDomain("not a url", [])).toBe(true);
    const v = evaluate(baseIntent, { phishDomains: ["app.uniswap.org"] });
    return expect(v).resolves.toMatchObject({ verdict: "block" });
  });

  it("spending limit: blocks when exceeded, warns at >=80%, silent below", () => {
    expect(checkSpendingLimit("0", "100", "1000")).toBeNull();
    expect(checkSpendingLimit("0", "800", "1000")?.code).toBe("SPEND_LIMIT_NEAR");
    expect(checkSpendingLimit("900", "101", "1000")?.code).toBe("SPEND_LIMIT_EXCEEDED");
    expect(checkSpendingLimit("0", "100", "0")).toBeNull(); // no limit
    return expect(evaluate(baseIntent, { spentBaseUnits: "950", spendLimitBaseUnits: "1000" }))
      .resolves.toMatchObject({ verdict: "block" });
  });

  it("EIP-712 domain mismatch warns; matching name passes", () => {
    expect(checkEip712Domain({ name: "Uniswap" }, "https://app.uniswap.org") === null).toBe(true);
    const f = checkEip712Domain({ name: "MetaMask", verifyingContract: "0xabc" }, "https://app.uniswap.org");
    expect(f?.code).toBe("EIP712_DOMAIN_MISMATCH");
    const v = evaluate(
      { ...baseIntent, kind: "dapp-sign", dataHex: "0x1234" },
      { typedDataDomain: { name: "MetaMask" } },
    );
    return expect(v).resolves.toMatchObject({ verdict: "warn" });
  });

  it("compareDeltas: match within tolerance passes, mismatch/missing blocks", () => {
    const sim = [
      { address: "0xAbC", token: "native", before: "1010", after: "0", delta: "-1010" },
      { address: "0xdef", token: "native", before: "0", after: "1000", delta: "1000" },
    ];
    const claimed = [
      { address: "0xabc", token: "native", delta: "-1010" },
      { address: "0xdef", token: "native", delta: "1000" },
    ];
    expect(compareDeltas(claimed, sim, 0n)).toBeNull();
    // fee tolerance: sender delta off by exactly the fee -> within tolerance
    expect(compareDeltas([{ address: "0xabc", token: "native", delta: "-1000" }], sim, 10n)).toBeNull();
    const bad = compareDeltas([{ address: "0xdef", token: "native", delta: "999" }], sim, 0n);
    expect(bad?.code).toBe("SIM_MISMATCH");
    const missing = compareDeltas([{ address: "0x999", token: "native", delta: "-1" }], sim, 0n);
    expect(missing?.severity).toBe("block");
    // evaluate() wires claimedDeltas + simulated into a block verdict
    return expect(
      evaluate(baseIntent, { claimedDeltas: [{ address: "0x1", token: "native", delta: "-99999" }], simulated: sim }),
    ).resolves.toMatchObject({ verdict: "block" });
  });

  it("setApprovalForAll(true) and max permit warn", () => {
    const one = (1n).toString(16).padStart(64, "0");
    const max = ((1n << 256n) - 1n).toString(16).padStart(64, "0");
    const saf = `0xa22cb465${"00".repeat(32)}${one}`;
    expect(checkDangerousSelector(saf)?.code).toBe("NFT_APPROVAL_ALL");
    const permit = `0xd505accf${"00".repeat(32)}${"00".repeat(32)}${max}${"00".repeat(64)}`;
    expect(checkDangerousSelector(permit)?.code).toBe("PERMIT_INFINITE");
    expect(checkDangerousSelector(`0xa22cb465${"00".repeat(32)}${"00".repeat(31)}00`)).toBeNull();
    expect(checkDangerousSelector(undefined)).toBeNull();
  });
});
