// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

package com.drift.signer

import com.facebook.react.bridge.*
import org.json.JSONObject

// TurboModule over the Rust core C ABI (see rust/src/ffi.rs, rust/src/ffi_jni.rs).
//
// Session model: Rust owns an in-memory session table keyed by opaque u64
// handles. Android holds ONLY the handle (Double) plus the encrypted vault
// blob in EncryptedSharedPreferences / Keystore. The raw seed never crosses
// JNI as a return value — helpers that would leak it are intentionally absent
// from the C ABI. On lock(), the native session is zeroized and dropped; the
// Kotlin-side handle is cleared and password strings are not retained.
class DriftSignerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = NAME

  companion object {
    const val NAME = "DriftSigner"

    init {
      System.loadLibrary("drift_signer")
    }
  }

  // JNI symbols provided by rust/src/ffi_jni.rs (libdrift_signer.so built via
  // cargo-ndk). Both take/return JSON strings; errors come back as {"error":...}.
  private external fun driftCapabilities(): String
  private external fun driftCall(method: String, requestJson: String): String

  /** Invoke a signer method; throws SignerException with the Rust error message. */
  private fun call(method: String, request: JSONObject): JSONObject {
    val response = JSONObject(driftCall(method, request.toString()))
    if (response.has("error")) {
      throw SignerException(method, response.getString("error"))
    }
    return response
  }

  private class SignerException(val method: String, message: String) : Exception("$method: $message")

  private fun <T> Promise.safe(body: () -> T) {
    try {
      resolve(body())
    } catch (e: Exception) {
      reject("E_SIGNER", e.message, e)
    }
  }

  @ReactMethod
  fun capabilities(promise: Promise) = promise.safe { driftCapabilities() }

  @ReactMethod
  fun generateMnemonic(strengthBits: Int, promise: Promise) = promise.safe {
    call("generate_mnemonic", JSONObject().put("strengthBits", strengthBits)).getString("mnemonic")
  }

  @ReactMethod
  fun validateMnemonic(phrase: String, promise: Promise) = promise.safe {
    call("validate_mnemonic", JSONObject().put("phrase", phrase)).getBoolean("valid")
  }

  @ReactMethod
  fun entropyToVault(phrase: String, password: String, lightKdf: Boolean, promise: Promise) = promise.safe {
    call(
      "entropy_to_vault",
      JSONObject().put("phrase", phrase).put("password", password).put("lightKdf", lightKdf),
    )
  }

  @ReactMethod
  fun unlockVault(vaultJson: String, password: String, promise: Promise) = promise.safe {
    // vaultJson is the serialized EncryptedVault object; password is wrapped in
    // the same request envelope the Rust ABI expects — never sent alone.
    val req = JSONObject()
      .put("vault", JSONObject(vaultJson))
      .put("password", password)
    call("unlock_vault", req).getDouble("sessionId")
  }

  @ReactMethod
  fun lock(sessionId: Double, promise: Promise) = promise.safe {
    call("lock", JSONObject().put("sessionId", sessionId.toLong()))
    // Session zeroized inside Rust; nothing to retain here.
    true
  }

  @ReactMethod
  fun derivePubkey(sessionId: Double, path: String, curve: String, promise: Promise) = promise.safe {
    call(
      "derive_pubkey",
      JSONObject().put("sessionId", sessionId.toLong()).put("path", path).put("curve", curve),
    )
  }

  @ReactMethod
  fun signEvm(sessionId: Double, reqJson: String, promise: Promise) = promise.safe {
    call("sign_evm", JSONObject(reqJson).put("sessionId", sessionId.toLong()))
  }

  @ReactMethod
  fun signSolana(sessionId: Double, reqJson: String, promise: Promise) = promise.safe {
    call("sign_solana", JSONObject(reqJson).put("sessionId", sessionId.toLong()))
  }

  @ReactMethod
  fun signBitcoin(sessionId: Double, reqJson: String, promise: Promise) = promise.safe {
    call("sign_bitcoin", JSONObject(reqJson).put("sessionId", sessionId.toLong()))
  }

  @ReactMethod
  fun signCardano(sessionId: Double, reqJson: String, promise: Promise) = promise.safe {
    call("sign_cardano", JSONObject(reqJson).put("sessionId", sessionId.toLong()))
  }
}
