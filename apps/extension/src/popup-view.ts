// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U020 popup view-model. Pure TS — no framework imports.
// Portfolio mini + network picker + connect status + approve badge count.
// Shared by the popup shell and the full-page app (home tab reuses it).
import { z } from "zod";
import type { ApprovalEntry } from "./approval.js";
import { buildPortfolioModel, type PortfolioAsset, type PortfolioModel } from "./popup.js";

export const NetworkOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  testnet: z.boolean(),
  enabled: z.boolean(),
});
export type NetworkOption = z.infer<typeof NetworkOption>;

export const ConnectedOrigin = z.object({
  origin: z.string().url(),
  faviconUrl: z.string().url().optional(),
  connectedAt: z.number().int().nonnegative(),
});
export type ConnectedOrigin = z.infer<typeof ConnectedOrigin>;

export interface PopupViewInput {
  assets: PortfolioAsset[];
  networks: NetworkOption[];
  selectedNetwork: string;
  connectedOrigins: ConnectedOrigin[];
  approvalQueue: ApprovalEntry[];
  nowIso?: string;
}

const PopupViewInputSchema = z.object({
  assets: z.array(z.any()),
  networks: z.array(NetworkOption).min(1),
  selectedNetwork: z.string().min(1),
  connectedOrigins: z.array(ConnectedOrigin),
  approvalQueue: z.array(z.any()),
  nowIso: z.string().optional(),
});

export interface PopupViewModel {
  portfolio: PortfolioModel;
  networks: NetworkOption[];
  selectedNetwork: NetworkOption;
  connectedOrigins: ConnectedOrigin[];
  connectedCount: number;
  pendingCount: number;
  /** Badge text for the approve CTA: "" when none, "9+" capped. */
  badge: string;
}

/** Approve-CTA badge: "" | "1".."9" | "9+". */
export function approveBadge(count: number): string {
  const n = z.number().int().nonnegative().parse(count);
  if (n === 0) return "";
  return n > 9 ? "9+" : String(n);
}

export function buildPopupView(input: PopupViewInput): PopupViewModel {
  const v = PopupViewInputSchema.parse(input);
  const selected = v.networks.find((n) => n.id === v.selectedNetwork);
  if (!selected) throw new Error(`unknown network: ${v.selectedNetwork}`);
  if (!selected.enabled) throw new Error(`network disabled: ${v.selectedNetwork}`);
  const queue = v.approvalQueue as ApprovalEntry[];
  const pendingCount = queue.filter((e) => e.decision === "pending").length;
  return {
    portfolio: buildPortfolioModel(input.assets, input.nowIso),
    networks: v.networks,
    selectedNetwork: selected,
    connectedOrigins: v.connectedOrigins,
    connectedCount: v.connectedOrigins.length,
    pendingCount,
    badge: approveBadge(pendingCount),
  };
}

/** Pure network-picker transition. Throws on unknown/disabled networks. */
export function selectNetwork(networks: NetworkOption[], id: string): NetworkOption {
  const list = z.array(NetworkOption).parse(networks);
  const found = list.find((n) => n.id === z.string().min(1).parse(id));
  if (!found) throw new Error(`unknown network: ${id}`);
  if (!found.enabled) throw new Error(`network disabled: ${id}`);
  return found;
}
