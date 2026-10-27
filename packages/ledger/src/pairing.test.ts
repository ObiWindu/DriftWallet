// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { checkAppVersion, compareVersions, pairDevice, recordAppVersion } from "./pairing.js";

describe("pairing", () => {
  it("pairs a device with timestamp", () => {
    const d = pairDevice({ deviceId: "dev-1", label: "Nano X" });
    expect(d.deviceId).toBe("dev-1");
    expect(typeof d.pairedAt).toBe("string");
  });

  it("passes when app version meets minimum", () => {
    const d = pairDevice({ deviceId: "d", label: "l", appVersions: { evm: "1.9.19" } });
    const check = checkAppVersion(d, "evm");
    expect(check.ok).toBe(true);
  });

  it("fails when app version is too old", () => {
    const d = pairDevice({ deviceId: "d", label: "l", appVersions: { evm: "1.0.0" } });
    const check = checkAppVersion(d, "evm");
    expect(check.ok).toBe(false);
    expect(check.message).toContain("too old");
  });

  it("fails when app is missing, then recovers after recordAppVersion", () => {
    const d = pairDevice({ deviceId: "d", label: "l" });
    expect(checkAppVersion(d, "solana").ok).toBe(false);
    const updated = recordAppVersion(d, "solana", "1.2.3");
    expect(checkAppVersion(updated, "solana").ok).toBe(true);
  });

  it("compareVersions orders semver", () => {
    expect(compareVersions("1.9.0", "1.9.0")).toBe(0);
    expect(compareVersions("1.8.9", "1.9.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  });
});
