// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

package com.drift.signer

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

// Registers the DriftSigner TurboModule (backed by libdrift_signer.so via
// rust/src/ffi_jni.rs). Add to MainApplication.getPackages():
//   add(DriftSignerPackage())
class DriftSignerPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == DriftSignerModule.NAME) DriftSignerModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
      ReactModuleInfoProvider {
        mapOf(
          DriftSignerModule.NAME to ReactModuleInfo(
            DriftSignerModule.NAME,
            DriftSignerModule::class.java.name,
            false, // canOverrideExistingModule
            false, // needsEagerInit
            true,  // hasConstants — TurboModule surface is promise-methods only
            false, // isCxxModule
            true,  // isTurboModule
          )
        )
      }
}
