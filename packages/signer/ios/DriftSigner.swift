// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import Foundation

// TurboModule over the Rust core C ABI (rust/src/ffi.rs via drift_signer.h).
//
// Session model: Rust owns an in-memory session table keyed by opaque u64
// handles. Swift holds ONLY the handle plus the encrypted vault blob in the
// Keychain (kSecClassGenericPassword, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly).
// The raw seed never leaves Rust — helpers that would leak it are absent from
// the C ABI. On lock(), the native session is zeroized and dropped; the
// Swift-side handle is set to nil and password buffers are zeroized.

@objc(DriftSigner)
final class DriftSigner: NSObject {
  private var sessionHandle: UInt64?

  // libdrift_signer.a built from packages/signer/rust via cargo-lipo.
  @objc static func requiresMainQueueSetup() -> Bool { false }

  enum SignerError: Error {
    case rustError(String)
    case badResponse
  }

  /// Call drift_call(method, req) and parse the JSON envelope.
  /// Throws SignerError.rustError with the Rust message on {"error":...}.
  private func call(_ method: String, _ json: String) throws -> [String: Any] {
    guard let out = drift_call(method, json) else { throw SignerError.badResponse }
    defer { drift_free(UnsafeMutableRawPointer(mutating: out)) }
    let text = String(cString: out)
    guard let data = text.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw SignerError.badResponse
    }
    if let error = obj["error"] as? String { throw SignerError.rustError(error) }
    return obj
  }

  private func caps() throws -> String {
    guard let out = drift_capabilities() else { throw SignerError.badResponse }
    defer { drift_free(UnsafeMutableRawPointer(mutating: out)) }
    return String(cString: out)
  }

  @objc func capabilities(_ resolve: @escaping (String) -> Void,
                          rejecter reject: @escaping (String, String, Error?) -> Void) {
    do { resolve(try caps()) } catch { reject("E_SIGNER", "\(error)", error) }
  }

  @objc func generateMnemonic(_ strengthBits: Double,
                              _ resolve: @escaping (String) -> Void,
                              _ reject: @escaping (String, String, Error?) -> Void) {
    do {
      let r = try call("generate_mnemonic", "{\"strengthBits\":\(Int(strengthBits))}")
      resolve((r["mnemonic"] as? String) ?? "")
    } catch { reject("E_SIGNER", "\(error)", error) }
  }

  @objc func validateMnemonic(_ phrase: String,
                              _ resolve: @escaping (Bool) -> Void,
                              _ reject: @escaping (String, String, Error?) -> Void) {
    do {
      let r = try call("validate_mnemonic", "{\"phrase\":\(jsonString(phrase))}")
      resolve((r["valid"] as? Bool) ?? false)
    } catch { reject("E_SIGNER", "\(error)", error) }
  }

  @objc func entropyToVault(_ phrase: String,
                            _ password: String,
                            _ lightKdf: Bool,
                            _ resolve: @escaping (NSDictionary) -> Void,
                            _ reject: @escaping (String, String, Error?) -> Void) {
    var pwd = Array(password.utf8)
    defer { for i in pwd.indices { pwd[i] = 0 } }
    do {
      let req = "{\"phrase\":\(jsonString(phrase)),\"password\":\(jsonString(String(decoding: pwd, as: UTF8.self))),\"lightKdf\":\(lightKdf)}"
      resolve(try call("entropy_to_vault", req) as NSDictionary)
    } catch { reject("E_SIGNER", "\(error)", error) }
  }

  @objc func unlockVault(_ vaultJson: String,
                         _ password: String,
                         _ resolve: @escaping (Double) -> Void,
                         _ reject: @escaping (String, String, Error?) -> Void) {
    // vaultJson is the serialized EncryptedVault object; password rides in the
    // same request envelope the Rust ABI expects — never sent alone.
    var pwd = Array(password.utf8)
    defer { for i in pwd.indices { pwd[i] = 0 } }
    do {
      let req = "{\"vault\":\(vaultJson),\"password\":\(jsonString(String(decoding: pwd, as: UTF8.self)))}"
      let r = try call("unlock_vault", req)
      guard let id = (r["sessionId"] as? NSNumber)?.uint64Value else { throw SignerError.badResponse }
      sessionHandle = id // handle only — never persisted
      resolve(Double(id))
    } catch { reject("E_UNLOCK", "\(error)", error) }
  }

  @objc func lock(_ resolve: @escaping (Bool) -> Void,
                  rejecter reject: @escaping (String, String, Error?) -> Void) {
    if let id = sessionHandle {
      do {
        _ = try call("lock", "{\"sessionId\":\(id)}")
      } catch {
        reject("E_LOCK", "\(error)", error)
        return
      }
      sessionHandle = nil
    }
    resolve(true)
  }

  @objc func derivePubkey(_ sessionId: Double,
                          _ path: String,
                          _ curve: String,
                          _ resolve: @escaping (NSDictionary) -> Void,
                          _ reject: @escaping (String, String, Error?) -> Void) {
    do {
      let req = "{\"sessionId\":\(UInt64(sessionId)),\"path\":\(jsonString(path)),\"curve\":\(jsonString(curve))}"
      resolve(try call("derive_pubkey", req) as NSDictionary)
    } catch { reject("E_SIGNER", "\(error)", error) }
  }

  @objc func signEvm(_ sessionId: Double, _ reqJson: String,
                     _ resolve: @escaping (NSDictionary) -> Void,
                     _ reject: @escaping (String, String, Error?) -> Void) {
    sign("sign_evm", sessionId, reqJson, resolve, reject)
  }

  @objc func signSolana(_ sessionId: Double, _ reqJson: String,
                        _ resolve: @escaping (NSDictionary) -> Void,
                        _ reject: @escaping (String, String, Error?) -> Void) {
    sign("sign_solana", sessionId, reqJson, resolve, reject)
  }

  @objc func signBitcoin(_ sessionId: Double, _ reqJson: String,
                         _ resolve: @escaping (NSDictionary) -> Void,
                         _ reject: @escaping (String, String, Error?) -> Void) {
    sign("sign_bitcoin", sessionId, reqJson, resolve, reject)
  }

  @objc func signCardano(_ sessionId: Double, _ reqJson: String,
                         _ resolve: @escaping (NSDictionary) -> Void,
                         _ reject: @escaping (String, String, Error?) -> Void) {
    sign("sign_cardano", sessionId, reqJson, resolve, reject)
  }

  private func sign(_ method: String, _ sessionId: Double, _ reqJson: String,
                    _ resolve: @escaping (NSDictionary) -> Void,
                    _ reject: @escaping (String, String, Error?) -> Void) {
    do {
      // Inject sessionId into the request object server-side (Rust re-validates).
      guard let data = reqJson.data(using: .utf8),
            var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
        throw SignerError.badResponse
      }
      obj["sessionId"] = UInt64(sessionId)
      let merged = String(data: try JSONSerialization.data(withJSONObject: obj), encoding: .utf8) ?? reqJson
      resolve(try call(method, merged) as NSDictionary)
    } catch { reject("E_SIGNER", "\(error)", error) }
  }

  /// JSON-quoted string literal for hand-built request envelopes.
  private func jsonString(_ s: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [s]),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [String],
          let quoted = arr.first else { return "\"\"" }
    return "\"\(quoted)\""
  }
}
