// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U022 full-page app model (extension-local). Screens: onboarding, home,
// activity, settings. Reuses the popup view-model for the home tab and the
// navigation stack for routing. Pure TS — the .tsx shell only renders.
import { z } from "zod";
import type { PopupViewModel } from "./popup-view.js";
import type { AppScreen } from "./navigation.js";

export const OnboardingStep = z.enum(["entry", "password", "backup", "quiz", "done"]);
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export interface OnboardingModel {
  step: OnboardingStep;
  /** 0..1 progress for the indicator. */
  progress: number;
}

const STEP_PROGRESS: Record<OnboardingStep, number> = {
  entry: 0.2,
  password: 0.4,
  backup: 0.7,
  quiz: 0.9,
  done: 1,
};

export function onboardingFor(step: OnboardingStep): OnboardingModel {
  const s = OnboardingStep.parse(step);
  return { step: s, progress: STEP_PROGRESS[s] };
}

export const ActivityStatus = z.enum(["pending", "confirmed", "failed"]);
export type ActivityStatus = z.infer<typeof ActivityStatus>;

export const ActivityItem = z.object({
  id: z.string().min(1),
  chain: z.string().min(1),
  kind: z.string().min(1),
  status: ActivityStatus,
  txHash: z.string().min(1),
  explorerUrl: z.string().url().optional(),
  hiddenAsSpam: z.boolean().default(false),
  at: z.number().int().nonnegative(),
});
export type ActivityItem = z.infer<typeof ActivityItem>;

export const SettingsModel = z.object({
  autoLockSecs: z.number().int().min(30).max(1800),
  biometrics: z.boolean(),
  testnet: z.boolean(),
  spamHide: z.boolean().default(true),
});
export type SettingsModel = z.infer<typeof SettingsModel>;

export function defaultSettings(): SettingsModel {
  return SettingsModel.parse({ autoLockSecs: 300, biometrics: false, testnet: true, spamHide: true });
}

export function updateSettings(current: SettingsModel, patch: Partial<SettingsModel>): SettingsModel {
  return SettingsModel.parse({ ...SettingsModel.parse(current), ...patch });
}

export interface FullPageModel {
  route: AppScreen;
  popup: PopupViewModel;
  activity: ActivityItem[];
  settings: SettingsModel;
  onboarding: OnboardingModel;
}

/** Activity list for display: spam hidden when the toggle is on. */
export function visibleActivity(items: ActivityItem[], settings: SettingsModel): ActivityItem[] {
  const list = z.array(ActivityItem).parse(items);
  const s = SettingsModel.parse(settings);
  return (s.spamHide ? list.filter((i) => !i.hiddenAsSpam) : list).sort((a, b) => b.at - a.at);
}

/** Explorer deep link helper (display only — no fetch). */
export function explorerLink(chain: string, txHash: string): string | null {
  const c = z.string().min(1).parse(chain);
  const h = z.string().min(1).parse(txHash);
  const bases: Record<string, string> = {
    "eip155:1": "https://etherscan.io/tx/",
    "eip155:11155111": "https://sepolia.etherscan.io/tx/",
    "solana:mainnet": "https://explorer.solana.com/tx/",
    "solana:devnet": "https://explorer.solana.com/tx/?cluster=devnet",
  };
  const base = bases[c];
  return base ? `${base}${h}` : null;
}
