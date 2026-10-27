// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildEvmHardwareIntent } from "./evm.js";

const BASE = {
  chainId: 1,
  to: "0x000000000000000000000000000000000000dEaD",
  valueWei: "1000000000000000000",
  nonce: 0,
  gasLimit: "21000",
  maxFeePerGasWei: "1000000000",
  maxPriorityFeePerGasWei: "1000000000",
} as const;

describe("evm hardware intent", () => {
  it("builds native transfer with hardware flag + signerRequest mirror", () => {
    const { intent, display } = buildEvmHardwareIntent({ ...BASE });
    expect(intent.hardware).toBe(true);
    expect(intent.signerRequest.chain_id).toBe(1);
    expect(intent.signerRequest.to).toBe("000000000000000000000000000000000000dead");
    expect(intent.path).toBe("m/44'/60'/0'/0/0");
    expect(display.decodedCall).toBe("Native transfer");
    expect(display.warnings[0]).toContain("Hardware wallet");
  });

  it("builds typed-data display model with hash", () => {
    const hash = "0x" + "ab".repeat(32);
    const { intent, display } = buildEvmHardwareIntent({ ...BASE, typedDataHashHex: hash });
    expect(intent.typedDataHashHex).toBe(hash);
    expect(display.decodedCall).toContain("EIP-712");
  });

  it("blocks opaque calldata when device did not display hash", () => {
    expect(() =>
      buildEvmHardwareIntent({
        ...BASE,
        dataHex: "0xdeadbeef",
        opaqueData: true,
        deviceAttestation: { hashDisplayed: false },
      }),
    ).toThrow(/OPAQUE_SIGN/);
  });

  it("rejects forbidden chain", () => {
    expect(() => buildEvmHardwareIntent({ ...BASE, chainId: 999999 })).toThrow(/forbidden chain/);
  });

  it("decodes ERC-20 approve calldata", () => {
    const { display } = buildEvmHardwareIntent({
      ...BASE,
      dataHex: "0x095ea7b30000000000000000000000000000000000000000000000000000000000000001",
      deviceAttestation: { hashDisplayed: true },
    });
    expect(display.decodedCall).toBe("ERC-20 approve");
  });
});
