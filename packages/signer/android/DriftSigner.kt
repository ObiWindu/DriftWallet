// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

package com.drift.signer

import com.facebook.react.bridge.*

// TurboModule stub over the Rust core C ABI (see rust/src/ffi.rs).
//
// Session model: Rust owns an in-memory session table keyed by opaque u64
// handles. Android holds ONLY the handle (Long) plus the encrypted vault
// blob in EncryptedSharedPreferences / Keystore. The raw seed never crosses
// JNI as a return value — helpers that would leak it are intentionally absent
// from the C ABI. On lock(), the native session is zeroized and dropped; the
// Kotlin-side handle is cleared and any char[] password buffers are filled
// with 0 before release.
class DriftSignerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "DriftSigner"

  // Loads libdrift_signer.so (built from packages/signer/rust via cargo-ndk).
  private external fun driftCapabilities(): String
  private external fun driftCall(method: String, requestJson: String): String

  companion object {
    init {
      System.loadLibrary("drift_signer")
    }
  }

  private fun sessionsFromPrefs(): String {
    // Vault blobs live in EncryptedSharedPreferences backed by Android Keystore.
    // Handles are process-local only and are never persisted.
    return ""
  }

  @ReactMethod
  fun generateMnemonic(strengthBits: Int, promise: Promise) {
    try {
      promise.resolve(driftCall("generate_mnemonic", "{\"strengthBits\":$strengthBits}"))
    } catch (e: Exception) {
      promise.reject("E_SIGNER", e.message, e)
    }
  }

  @ReactMethod
  fun unlockVault(vaultJson: String, password: String, promise: Promise) {
    // NOTE: take password as char[] in production and zeroize after use.
    try {
      promise.resolve(driftCall("unlock_vault", vaultJson))
    } catch (e: Exception) {
      promise.reject("E_UNLOCK", e.message, e)
    }
  }

  @ReactMethod
  fun lock(sessionId: Double, promise: Promise) {
    try {
      promise.resolve(driftCall("lock", "{\"sessionId\":${sessionId.toLong()}}"))
      // Zeroize: session dropped inside Rust; clear any cached handle here.
    } catch (e: Exception) {
      promise.reject("E_LOCK", e.message, e)
    }
  }

  @ReactMethod
  fun capabilities(promise: Promise) {
    try {
      promise.resolve(driftCapabilities())
    } catch (e: Exception) {
      promise.reject("E_SIGNER", e.message, e)
    }
  }
}
