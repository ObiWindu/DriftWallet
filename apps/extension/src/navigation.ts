// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U022 full-page navigation model + drift:// deep-link parity helper.
// Extension-local mirror of mobile's `deepLinkForWc` (`drift://wc?uri=…`):
// same scheme, same wc shape, plus screen routes for the full-page app.
// Pure TS — no window/location access; callers wire it to hash routing.
import { z } from "zod";

export const AppScreen = z.enum(["onboarding", "home", "activity", "settings", "approve", "receive", "wc"]);
export type AppScreen = z.infer<typeof AppScreen>;

export const DeepLink = z.object({
  screen: AppScreen,
  params: z.record(z.string(), z.string()).default({}),
});
export type DeepLink = z.infer<typeof DeepLink>;

const SCREEN_PATHS: Record<AppScreen, string> = {
  onboarding: "onboarding",
  home: "home",
  activity: "activity",
  settings: "settings",
  approve: "approve",
  receive: "receive",
  wc: "wc",
};

const PATH_SCREENS: Record<string, AppScreen> = Object.fromEntries(
  Object.entries(SCREEN_PATHS).map(([screen, path]) => [path, screen as AppScreen]),
);

/** Mobile parity: `drift://wc?uri=<encoded wc uri>` (mobile `deepLinkForWc`). */
export function deepLinkForWc(uri: string): string {
  if (!z.string().startsWith("wc:").safeParse(uri).success) throw new Error("bad wc uri");
  return `drift://wc?uri=${encodeURIComponent(uri)}`;
}

/** Format a deep link: `drift://<screen>?k=v&…`. */
export function formatDeepLink(link: DeepLink): string {
  const l = DeepLink.parse(link);
  const qs = new URLSearchParams(l.params).toString();
  return `drift://${SCREEN_PATHS[l.screen]}${qs ? `?${qs}` : ""}`;
}

/** Parse a `drift://` URL. Throws on wrong scheme, unknown screen, or bad input. */
export function parseDeepLink(url: string): DeepLink {
  const u = z.string().min("drift://".length + 1).parse(url);
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error(`bad deep link: ${url}`);
  }
  if (parsed.protocol !== "drift:") throw new Error(`bad scheme: ${parsed.protocol}`);
  // drift://wc?uri=… → hostname "wc"; drift://home → hostname "home".
  const screen = PATH_SCREENS[parsed.hostname.toLowerCase()];
  if (!screen) throw new Error(`unknown screen: ${parsed.hostname}`);
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  if (screen === "wc" && !params["uri"]) throw new Error("wc link missing uri param");
  return DeepLink.parse({ screen, params });
}

// ---- Navigation stack model (pure, immutable) ----

export const NavState = z.object({
  current: AppScreen,
  history: z.array(AppScreen).max(50),
  params: z.record(z.string(), z.string()).default({}),
});
export type NavState = z.infer<typeof NavState>;

export function initialNav(screen: AppScreen = "home"): NavState {
  return NavState.parse({ current: AppScreen.parse(screen), history: [], params: {} });
}

/** Push current onto history and move. Unknown screens throw (zod). */
export function navigate(state: NavState, screen: AppScreen, params?: Record<string, string>): NavState {
  const s = NavState.parse(state);
  const next = AppScreen.parse(screen);
  return NavState.parse({
    current: next,
    history: [...s.history, s.current].slice(-50),
    params: params ?? {},
  });
}

/** Pop history; stays put when empty. */
export function goBack(state: NavState): NavState {
  const s = NavState.parse(state);
  const prev = s.history[s.history.length - 1];
  if (!prev) return s;
  return NavState.parse({ current: prev, history: s.history.slice(0, -1), params: {} });
}

/** Deep link → nav state (fresh stack rooted at the linked screen). */
export function navFromDeepLink(url: string): NavState {
  const link = parseDeepLink(url);
  return NavState.parse({ current: link.screen, history: [], params: link.params });
}
