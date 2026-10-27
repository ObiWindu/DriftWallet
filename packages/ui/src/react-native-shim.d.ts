// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Ambient types for `react-native` so `tsc --noEmit` passes without the
// native toolchain installed. Real shells use genuine @types/react-native;
// this shim only needs to be permissive enough for presentational code.
// Test runtime resolution is handled by vitest.config.ts alias -> __mocks__.
declare module "react-native" {
  import type * as React from "react";
  export const View: React.ComponentType<any>;
  export const Text: React.ComponentType<any>;
  export const Pressable: React.ComponentType<any>;
  export const TextInput: React.ComponentType<any>;
  export const ScrollView: React.ComponentType<any>;
  export const StyleSheet: { create<T extends Record<string, unknown>>(styles: T): T };
  export const Platform: { OS: string; select: <T>(s: { test?: T; default?: T }) => T | undefined };
}
