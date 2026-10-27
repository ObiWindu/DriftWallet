// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Minimal react-native stub for unit tests (vitest only).
// Real RN shells resolve the genuine `react-native` package; this file is
// wired via vitest `resolve.alias` in vitest.config.ts so `vitest run` passes
// without a native toolchain. It must never ship in a native bundle.
//
// Each primitive passes children through a Fragment so react-test-renderer
// trees stay queryable by testID (real RN renders children natively).
import { createElement, Fragment } from "react";

interface PrimProps {
  children?: unknown;
  testID?: string;
  accessibilityLabel?: string;
  onPress?: () => void;
  value?: string;
  onChangeText?: (t: string) => void;
  secureTextEntry?: boolean;
}

function prim(props: PrimProps): ReturnType<typeof createElement> {
  return createElement(Fragment, null, props.children as never);
}

export function View(props: PrimProps): ReturnType<typeof createElement> {
  return prim(props);
}

export function Text(props: PrimProps): ReturnType<typeof createElement> {
  return prim(props);
}

export function Pressable(props: PrimProps): ReturnType<typeof createElement> {
  return prim(props);
}

export function TextInput(props: PrimProps): ReturnType<typeof createElement> {
  return prim(props);
}

export function ScrollView(props: PrimProps): ReturnType<typeof createElement> {
  return prim(props);
}

export const StyleSheet = {
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles;
  },
};

export const Platform = { OS: "test", select: <T>(s: { test?: T; default?: T }): T | undefined => s.test ?? s.default };
