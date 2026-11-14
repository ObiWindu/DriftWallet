// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// C ABI of the Rust signer core (packages/signer/rust/src/ffi.rs), exposed to
// Swift via the DriftRN bridging header. All functions speak JSON strings:
// success is `{...}`, failure is `{"error":"..."}`. Every returned pointer
// MUST be released with drift_free.

#ifndef DRIFT_SIGNER_H
#define DRIFT_SIGNER_H

#ifdef __cplusplus
extern "C" {
#endif

/// JSON describing the signer surface: functions + allowed chains/paths.
const char *drift_capabilities(void);

/// Dispatcher: route `method` (e.g. "unlock_vault") with JSON `req`.
const char *drift_call(const char *method, const char *req);

/// Release a pointer returned by drift_capabilities / drift_call (NULL is a no-op).
void drift_free(void *ptr);

#ifdef __cplusplus
}
#endif

#endif // DRIFT_SIGNER_H
