// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Mobile shell stub (T009 full RN wiring).
// Security notes enforced in native shell, not JS:
// - android:allowBackup=false, FLAG_SECURE on seed screens
// - iOS: kSecAttrAccessibleWhenUnlockedThisDeviceOnly, no iCloud sync
// - MMKV encrypted + Keychain/Keystore, auto-lock 5min, biometric gate for sign/export
export const MOBILE_SECURITY_CHECKLIST = [
  "FLAG_SECURE seed screens",
  "allowBackup=false / kSecAttrSynchronizable=false",
  "cert pinning gateway",
  "jailbreak/root detect (warn)",
  "biometric gate amount>$100",
] as const;

export function deepLinkForWc(uri: string): string {
  if (!uri.startsWith("wc:")) throw new Error("bad wc uri");
  return `drift://wc?uri=${encodeURIComponent(uri)}`;
}
