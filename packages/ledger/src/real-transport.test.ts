// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

const mockTransport = { deviceModel: { productName: "Nano X" }, close: vi.fn(async () => {}) };

vi.mock("@ledgerhq/hw-transport-webusb", () => ({
  default: {
    isSupported: async () => true,
    list: async () => [{ vendorId: 0x2c97, productId: 0x4015, productName: "Nano X" }],
    create: async () => mockTransport,
  },
}));

vi.mock("@ledgerhq/hw-app-eth", () => ({
  default: class Eth {
    constructor(public transport: unknown) {}
    async signTransaction(path: string, rawTxHex: string) {
      expect(path).toBe("m/44'/60'/0'/0/0");
      expect(rawTxHex).toMatch(/^[0-9a-f]+$/);
      return { r: "11".repeat(32), s: "22".repeat(32), v: "1c" };
    }
  },
}));

vi.mock("@ledgerhq/hw-app-solana", () => ({
  default: class Solana {
    constructor(public transport: unknown) {}
    async signTransaction(path: string, tx: { length: number }) {
      expect(path).toBe("m/44'/501'/0'/0'");
      expect(tx.length).toBe(4);
      return { signature: Buffer.from("ab".repeat(64), "hex") };
    }
  },
}));

import { TransportRegistry } from "./transport.js";
import { createLedgerTransport, createWebUsbTransport } from "./real-transport.js";

describe("real ledger transport (mocked @ledgerhq modules)", () => {
  it("lists, connects, signs evm + solana, disconnects", async () => {
    const fns = await createWebUsbTransport();
    const registry = new TransportRegistry(fns);

    const devices = await registry.listDevices();
    expect(devices).toHaveLength(1);
    const device = devices[0];
    if (!device) throw new Error("no device listed");
    expect(device.transport).toBe("usb");
    expect(device.label).toBe("Nano X");

    const conn = await registry.connect(device.deviceId);
    expect(registry.hasSession(conn.sessionId)).toBe(true);

    const evmSig = await registry.sign({
      sessionId: conn.sessionId,
      path: "m/44'/60'/0'/0/0",
      payloadHex: "0x02f8deadbeef",
      chain: "evm",
    });
    expect(evmSig.signatureHex).toBe(`0x${"11".repeat(32)}${"22".repeat(32)}1c`);
    expect(evmSig.deviceId).toBe(device.deviceId);

    const solSig = await registry.sign({
      sessionId: conn.sessionId,
      path: "m/44'/501'/0'/0'",
      payloadHex: "0xdeadbeef",
      chain: "solana",
    });
    expect(solSig.signatureHex).toBe(`0x${"ab".repeat(64)}`);

    await registry.disconnect(conn.sessionId);
    expect(registry.hasSession(conn.sessionId)).toBe(false);
    expect(mockTransport.close).toHaveBeenCalled();
  });

  it("rejects unknown sessions and unsupported chain apps", async () => {
    const fns = createLedgerTransport(
      { list: async () => [], create: async () => mockTransport },
      "usb",
    );
    const registry = new TransportRegistry(fns);
    const conn = await registry.connect("usb:2c97:4015:0");
    await expect(
      registry.sign({ sessionId: "nope", path: "m/84'/0'/0'/0/0", payloadHex: "0x00", chain: "bitcoin" }),
    ).rejects.toThrow(/unknown session/);
    await expect(
      registry.sign({ sessionId: conn.sessionId, path: "m/84'/0'/0'/0/0", payloadHex: "0x00", chain: "bitcoin" }),
    ).rejects.toThrow(/not wired/);
    await expect(registry.disconnect("nope")).rejects.toThrow(/unknown session/);
  });
});
