// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { TransportRegistry, createMemoryTransport, describeSignRequestSafe } from "./transport.js";

describe("transport registry", () => {
  it("lists seeded mock devices", async () => {
    const reg = new TransportRegistry(createMemoryTransport([{}]));
    const devices = await reg.listDevices();
    expect(devices.length).toBe(1);
    expect(devices[0]?.transport).toBe("mock");
  });

  it("connects and signs through an injected mock", async () => {
    const reg = new TransportRegistry(createMemoryTransport([{ deviceId: "dev-1", label: "Nano" }]));
    const { sessionId, deviceId } = await reg.connect("dev-1");
    expect(deviceId).toBe("dev-1");
    expect(reg.hasSession(sessionId)).toBe(true);
    const res = await reg.sign({ sessionId, path: "m/44'/60'/0'/0/0", payloadHex: "0x1234", chain: "evm" });
    expect(res.deviceId).toBe("dev-1");
    expect(res.signatureHex.startsWith("0x")).toBe(true);
  });

  it("rejects unknown device and unknown session", async () => {
    const reg = new TransportRegistry(createMemoryTransport([{}]));
    await expect(reg.connect("nope")).rejects.toThrow();
    await expect(
      reg.sign({ sessionId: "sess-999", path: "m/44'/60'/0'/0/0", payloadHex: "0x00", chain: "evm" }),
    ).rejects.toThrow(/unknown session/);
  });

  it("disconnect clears the session", async () => {
    const reg = new TransportRegistry(createMemoryTransport([{}]));
    const devices = await reg.listDevices();
    const { sessionId } = await reg.connect(devices[0]?.deviceId ?? "");
    await reg.disconnect(sessionId);
    expect(reg.hasSession(sessionId)).toBe(false);
  });

  it("safe describer never leaks payload bytes", () => {
    const s = describeSignRequestSafe({
      sessionId: "sess-1",
      path: "m/44'/60'/0'/0/0",
      payloadHex: "0xdeadbeef",
      chain: "evm",
    });
    expect(s).not.toContain("deadbeef");
    expect(s).toContain("evm");
  });
});
