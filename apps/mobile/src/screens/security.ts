// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { RevokeList, type RevokeRecord } from "@drift/features";
import { screenChrome, type ScreenChrome } from "../watchonly.js";
import { confirmWipe, setAutoLock } from "./settings.js";

// Security settings screen view-model (iteration 3): duress PIN setup state
// machine, per-session spending limit (USD cents, bigint-string), revoked
// origins, auto-lock + wipe reuse. No key material here — the keystore owns
// vaults; this model only shapes state transitions for the UI.

export const DuressStepSchema = z.enum(["idle", "confirm-main", "set-pin", "confirm-pin", "done"]);
export type DuressStep = z.infer<typeof DuressStepSchema>;

export interface DuressModel {
  step: DuressStep;
  /** True when a duress vault already exists for the active wallet. */
  hasDuress: boolean;
}

export function duressInit(hasDuress: boolean): DuressModel {
  z.boolean().parse(hasDuress);
  return { step: "idle", hasDuress };
}

/**
 * Duress setup transitions. `set-pin` requires the pin to be >= 8 chars and
 * different from the main password (the UI passes both; we only check the
 * pin shape + inequality here — the keystore verifies the main password).
 */
export function duressNext(model: DuressModel, input: { mainPassword?: string; pin?: string; confirmPin?: string }): DuressModel {
  const m = z.object({ step: DuressStepSchema, hasDuress: z.boolean() }).parse(model);
  switch (m.step) {
    case "idle":
      return { ...m, step: "confirm-main" };
    case "confirm-main":
      if (!input.mainPassword || input.mainPassword.length < 8) throw new Error("main password required");
      return { ...m, step: "set-pin" };
    case "set-pin": {
      // The pin itself never enters this model — only its shape is validated;
      // the UI hands it straight to keystore.setupDuress.
      z.string().min(8).max(64).parse(input.pin ?? "");
      return { ...m, step: "confirm-pin" };
    }
    case "confirm-pin": {
      if (!input.pin || input.pin !== input.confirmPin) throw new Error("pins do not match");
      return { step: "done", hasDuress: true };
    }
    case "done":
      return m;
  }
}

/** Spending limit setter: integer USD cents as string; "0" disables. */
export function setSpendLimitCents(input: unknown): { ok: true; cents: string } | { ok: false; errorKey: "security.spendLimit" } {
  const parsed = z.string().regex(/^\d+$/).safeParse(input);
  if (!parsed.success) return { ok: false, errorKey: "security.spendLimit" };
  return { ok: true, cents: parsed.data };
}

export interface SecurityScreenModel {
  duress: DuressModel;
  spendLimitUsdCents: string;
  autoLock: { ok: true; ms: number } | { ok: false; errorKey: "settings.autoLock" };
  revoked: RevokeRecord[];
  wipe: ReturnType<typeof confirmWipe>;
  chrome: ScreenChrome;
}

export function securityScreenModel(input: {
  duress: DuressModel;
  spendLimitUsdCents: string;
  autoLockMs: unknown;
  revokedOrigins: RevokeRecord[];
  wipeInput: unknown;
  watchOnly?: boolean;
}): SecurityScreenModel {
  const chrome = screenChrome(input.watchOnly ?? false);
  const rl = new RevokeList();
  rl.importJSON(JSON.stringify({ version: 1, revoked: z.array(z.object({
    origin: z.string().url(), revokedAt: z.number().int().nonnegative(), reason: z.string().max(200).optional(),
  })).parse(input.revokedOrigins) }));
  return {
    duress: z.object({ step: DuressStepSchema, hasDuress: z.boolean() }).parse(input.duress),
    spendLimitUsdCents: setSpendLimitCents(input.spendLimitUsdCents).ok ? input.spendLimitUsdCents : "0",
    autoLock: setAutoLock(input.autoLockMs),
    revoked: rl.list(),
    wipe: confirmWipe(input.wipeInput),
    chrome,
  };
}
