// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { LEDGER_ALLOWED_EVM_CHAINS, DerivationPath } from "./transport.js";

export const DeviceAttestation = z.object({
  /** True when the device screen displayed the exact hash being signed. */
  hashDisplayed: z.boolean(),
});
export type DeviceAttestation = z.infer<typeof DeviceAttestation>;

export const BlindSignKind = z.enum(["eth_sign", "typedData", "personal_sign", "opaque"]);
export type BlindSignKind = z.infer<typeof BlindSignKind>;

export const BlindSignInput = z.object({
  kind: BlindSignKind,
  /** Opaque / unknown calldata selectors must set this true. */
  opaque: z.boolean().default(false),
  deviceAttestation: DeviceAttestation,
});
export type BlindSignInput = z.infer<typeof BlindSignInput>;

export const BlindSignVerdict = z.enum(["allow", "warn", "block"]);
export type BlindSignVerdict = z.infer<typeof BlindSignVerdict>;

export const BlindSignDecision = z.object({
  verdict: BlindSignVerdict,
  warnings: z.array(z.string()),
  code: z.enum(["OK", "BLIND_SIGN_WARN", "OPAQUE_SIGN"]),
});
export type BlindSignDecision = z.infer<typeof BlindSignDecision>;

/**
 * Blind-sign policy for hardware wallets.
 *
 * - `typedData` / `personal_sign` with hash displayed on-device → allow.
 * - `eth_sign` / `opaque` payloads are blind signing: BLOCK with OPAQUE_SIGN
 *   unless the device attests the hash was displayed (hashDisplayed: true),
 *   in which case downgrade to a warn (user explicitly verified on-device).
 */
export function evaluateBlindSignPolicy(input: BlindSignInput): BlindSignDecision {
  const p = BlindSignInput.parse(input);
  const warnings: string[] = [];

  if (p.kind === "eth_sign" || p.kind === "opaque" || p.opaque) {
    if (!p.deviceAttestation.hashDisplayed) {
      return {
        verdict: "block",
        code: "OPAQUE_SIGN",
        warnings: [
          "OPAQUE_SIGN: blind signing blocked — device did not display the signed hash. Enable clear signing on the device and retry.",
        ],
      };
    }
    warnings.push(
      "Blind signing: payload was opaque; you confirmed the hash on the device screen. Verify the hash matches the dApp before approving.",
    );
    return { verdict: "warn", code: "BLIND_SIGN_WARN", warnings };
  }

  // typedData / personal_sign: clear-signable; still warn when the device
  // could not show the hash (e.g. small screen / legacy app).
  if (!p.deviceAttestation.hashDisplayed) {
    warnings.push("Device did not display the full message hash — verify origin and calldata carefully.");
    return { verdict: "warn", code: "BLIND_SIGN_WARN", warnings };
  }
  return { verdict: "allow", code: "OK", warnings };
}

/** Convenience guard: throws on block, returns warnings otherwise. */
export function requireBlindSignAllowed(input: BlindSignInput): string[] {
  const d = evaluateBlindSignPolicy(input);
  if (d.verdict === "block") throw new Error(d.warnings[0] ?? "OPAQUE_SIGN blocked");
  return [...d.warnings];
}

export const HardwareDisplay = z.object({
  decodedCall: z.string().min(1),
  warnings: z.array(z.string()),
});
export type HardwareDisplay = z.infer<typeof HardwareDisplay>;

export { LEDGER_ALLOWED_EVM_CHAINS, DerivationPath };
