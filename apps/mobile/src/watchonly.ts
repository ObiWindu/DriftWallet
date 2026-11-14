// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// Shared screen chrome guard (F-P1-10). Every screen model calls
// `screenChrome(watchOnly)` so the banner key and sign-CTA gate are uniform.
// The App shell renders the banner persistently; screens additionally disable
// their sign/submit CTAs via `canSign`.

export interface ScreenChrome {
  canSign: boolean;
  bannerKey: "watchOnly.banner" | null;
}

export function screenChrome(watchOnly: boolean): ScreenChrome {
  z.boolean().parse(watchOnly);
  return watchOnly
    ? { canSign: false, bannerKey: "watchOnly.banner" }
    : { canSign: true, bannerKey: null };
}

/** Throw when a sign operation is attempted on a watch-only account. */
export function assertCanSign(watchOnly: boolean): void {
  if (!screenChrome(watchOnly).canSign) {
    throw new Error("watch-only account cannot sign");
  }
}
