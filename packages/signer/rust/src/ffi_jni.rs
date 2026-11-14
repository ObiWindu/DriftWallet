// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! JNI glue for the Android TurboModule `com.drift.signer.DriftSignerModule`
//! (packages/signer/android/DriftSigner.kt).
//!
//! Compiled only for Android. The Kotlin `external fun` declarations resolve
//! to the `Java_com_drift_signer_DriftSignerModule_*` symbols below, which
//! adapt to the plain C ABI in [`crate::ffi`]: `drift_call` / `drift_capabilities`.
//! All payloads stay JSON strings; failures are returned as `{"error":...}`
//! JSON (never thrown across JNI) so the Kotlin side can reject its promise.

#![cfg(target_os = "android")]

use std::ffi::CString;
use std::os::raw::c_char;

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

use crate::ffi::{drift_call, drift_capabilities, drift_free};

/// Call `drift_call(method, req)` and return the JSON response as a Rust String.
fn call_rust(env: &mut JNIEnv, method: &JString, req: &JString) -> Result<String, String> {
    let method_s: String = env.get_string(method).map_err(|e| e.to_string())?.into();
    let req_s: String = env.get_string(req).map_err(|e| e.to_string())?.into();
    let method_c = CString::new(method_s).map_err(|_| "method contains NUL".to_string())?;
    let req_c = CString::new(req_s).map_err(|_| "request contains NUL".to_string())?;
    // Both pointers are valid NUL-terminated UTF-8 CStrings for the duration
    // of the call; the returned pointer is freed below.
    let out = drift_call(method_c.as_ptr(), req_c.as_ptr());
    if out.is_null() {
        return Err("null response from signer".to_string());
    }
    let text = unsafe { std::ffi::CStr::from_ptr(out) }
        .to_str()
        .map(|s| s.to_string())
        .map_err(|_| "invalid utf-8 from signer".to_string());
    // SAFETY: out was returned by drift_call and is freed exactly once.
    unsafe { drift_free(out as *mut c_char) };
    text
}

fn capabilities_rust() -> Result<String, String> {
    // drift_capabilities returns a pointer we free exactly once.
    let out = drift_capabilities();
    if out.is_null() {
        return Err("null response from signer".to_string());
    }
    let text = unsafe { std::ffi::CStr::from_ptr(out) }
        .to_str()
        .map(|s| s.to_string())
        .map_err(|_| "invalid utf-8 from signer".to_string());
    // SAFETY: out was returned by drift_capabilities and is freed exactly once.
    unsafe { drift_free(out as *mut c_char) };
    text
}

fn to_jstring(env: &mut JNIEnv, text: Result<String, String>) -> jstring {
    let payload = match text {
        Ok(s) => s,
        Err(e) => serde_json::json!({ "error": e }).to_string(),
    };
    match env.new_string(payload) {
        Ok(s) => s.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// `Java_com_drift_signer_DriftSignerModule_driftCall(String method, String req)`.
#[no_mangle]
pub extern "C" fn Java_com_drift_signer_DriftSignerModule_driftCall(
    mut env: JNIEnv,
    _class: JClass,
    method: JString,
    req: JString,
) -> jstring {
    let text = call_rust(&mut env, &method, &req);
    to_jstring(&mut env, text)
}

/// `Java_com_drift_signer_DriftSignerModule_driftCapabilities()`.
#[no_mangle]
pub extern "C" fn Java_com_drift_signer_DriftSignerModule_driftCapabilities(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    to_jstring(&mut env, capabilities_rust())
}
