// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Native hardening contract (T009). Documentation-as-code: the values below
// describe what the Android/iOS shells MUST enforce. JS cannot set these —
// native projects (MainActivity / AppDelegate / keychain wrappers) read this
// file as the checklist and mirror it in platform code + Maestro assertions.

/** Android WindowManager.LayoutParams.FLAG_SECURE on seed/backup screens. */
export const FLAG_SECURE = true;

/** android:allowBackup=false; no adb backup of app data. */
export const ALLOW_BACKUP = false;

/** iOS keychain item accessibility — never sync to iCloud. */
export const IOS_KEYCHAIN_ACCESS = "kSecAttrAccessibleWhenUnlockedThisDeviceOnly" as const;
export const IOS_SYNCHRONIZABLE = false;

/** Encrypted storage + lock policy mirrored by MMKV/Keychain wrappers. */
export const STORAGE_POLICY = {
  store: "MMKV-encrypted",
  keyInKeychain: true,
  autoLockMinutes: 5,
  screenshotProtection: FLAG_SECURE,
  allowBackup: ALLOW_BACKUP,
} as const;

/**
 * Attestation stubs. Native shell wires:
 * - Android: Play Integrity API (`decryptAndVerify`) before seed export.
 * - iOS: App Attest (`attestKey` / `generateAssertion`) before seed export.
 * JS only records the verdict string; enforcement lives natively.
 */
export const ATTESTATION = {
  android: "PlayIntegrity:requestIntegrityToken(nonce) -> verdict[MEETS_DEVICE_INTEGRITY]",
  ios: "AppAttest:attestKey(keyId,challenge) -> attestationObject",
  fallback: "jailbreak/root detected -> show warning, block export",
} as const;

export const NATIVE_HARDENING_CHECKLIST = [
  "FLAG_SECURE on Onboarding/BackupQuiz/Receive(seed QR)",
  "android:allowBackup=false; android:debuggable=false (release)",
  "kSecAttrAccessibleWhenUnlockedThisDeviceOnly + synchronizable=false",
  "TLS pinning for gateway origin",
  "Play Integrity / App Attest before export",
] as const;
