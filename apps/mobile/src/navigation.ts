// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// App navigation map (T009). Pure TS — no react-native imports.
// Native navigators (React Navigation) consume ROUTE_DEFS; this module
// is the source of truth for route names and auth gating.

export const ROUTES = [
  "Onboarding",
  "Password",
  "Biometric",
  "BackupQuiz",
  "Home",
  "Receive",
  "Send",
  "Activity",
  "Settings",
] as const;

export type RouteName = (typeof ROUTES)[number];

export interface RouteDef {
  name: RouteName;
  /** Requires an unlocked wallet session to visit. */
  requiresAuth: boolean;
  /** Seed / secret is visible on this screen (FLAG_SECURE required). */
  seedVisible: boolean;
}

export const ROUTE_DEFS: Record<RouteName, RouteDef> = {
  Onboarding: { name: "Onboarding", requiresAuth: false, seedVisible: false },
  Password: { name: "Password", requiresAuth: false, seedVisible: false },
  Biometric: { name: "Biometric", requiresAuth: false, seedVisible: false },
  BackupQuiz: { name: "BackupQuiz", requiresAuth: false, seedVisible: true },
  Home: { name: "Home", requiresAuth: true, seedVisible: false },
  Receive: { name: "Receive", requiresAuth: true, seedVisible: false },
  Send: { name: "Send", requiresAuth: true, seedVisible: false },
  Activity: { name: "Activity", requiresAuth: true, seedVisible: false },
  Settings: { name: "Settings", requiresAuth: true, seedVisible: false },
};

export function initialRoute(hasWallet: boolean): RouteName {
  return hasWallet ? "Password" : "Onboarding";
}

/** Auth gate: unauthenticated sessions may only visit public routes. */
export function canVisit(route: RouteName, authenticated: boolean): boolean {
  const def = ROUTE_DEFS[route];
  if (def.requiresAuth && !authenticated) return false;
  return true;
}

/** Minimal transition guard used by unit tests and native shell wiring. */
export function nextRoute(from: RouteName, authenticated: boolean): RouteName {
  if (!canVisit(from, authenticated)) return initialRoute(authenticated);
  return from;
}
