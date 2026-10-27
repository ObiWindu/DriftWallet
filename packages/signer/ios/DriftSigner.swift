// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import Foundation

// iOS TurboModule stub over the Rust core C ABI (see rust/src/ffi.rs).
//
// Session model: Rust owns an in-memory session table keyed by opaque u64
// handles. Swift holds ONLY the handle plus the encrypted vault blob in the
// Keychain (kSecClassGenericPassword, accessibleAfterFirstUnlockThisDeviceOnly).
// The raw seed never leaves Rust — helpers that would leak it are absent from
// the C ABI. On lock(), the native session is zeroized and dropped; the
// Swift-side handle is set to nil and password buffers are zeroized.

@objc(DriftSigner)
final class DriftSigner: NSObject {
  private var sessionHandle: UInt64?

  // libdrift_signer.a built from packages/signer/rust via cargo-lipo / uniffi.
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func capabilities(_ resolve: @escaping (String) -> Void,
                          rejecter reject: @escaping (String, String, Error?) -> Void) {
    // Calls drift_capabilities() -> JSON { functions, allowedChains, allowedPaths }.
    // Free the returned C string with drift_free().
    reject("E_UNIMPLEMENTED", "Link libdrift_signer.a first", nil)
  }

  @objc func unlockVault(_ vaultJson: String,
                         password: String,
                         resolve: @escaping (Double) -> Void,
                         rejecter reject: @escaping (String, String, Error?) -> Void) {
    // Calls drift_unlock_vault({"vault":..., "password":...}) -> {"sessionId": N}.
    // Store N in sessionHandle only (never persist). Password is a transient
    // parameter; zeroize any Data copy immediately after the call.
    var pwd = Array(password.utf8)
    defer {
      // zeroize on scope exit (lock path does the same for the handle)
      for i in pwd.indices { pwd[i] = 0 }
    }
    reject("E_UNIMPLEMENTED", "Link libdrift_signer.a first", nil)
  }

  @objc func lock(_ resolve: @escaping (Bool) -> Void,
                  rejecter reject: @escaping (String, String, Error?) -> Void) {
    // Calls drift_lock({"sessionId": N}) which zeroizes + drops the session.
    // Then: sessionHandle = nil.
    sessionHandle = nil
    resolve(true)
  }
}
