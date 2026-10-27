// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Full-page app entry: mounts AppShell on the onboarding entry route.
// Locked, empty initial state — same no-secrets contract as the popup.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./AppShell.js";
import { buildPopupView } from "./popup-view.js";
import { defaultSettings, onboardingFor } from "./app-model.js";

const NETWORKS = [
  { id: "eip155:1", label: "Ethereum", testnet: false, enabled: true },
  { id: "solana:mainnet", label: "Solana", testnet: false, enabled: true },
  { id: "bip122:000000000019d6689c085ae165831e93", label: "Bitcoin", testnet: false, enabled: true },
  { id: "cardano:mainnet", label: "Cardano", testnet: false, enabled: true },
];

const popup = buildPopupView({
  assets: [],
  networks: NETWORKS,
  selectedNetwork: "eip155:1",
  connectedOrigins: [],
  approvalQueue: [],
});

const root = document.getElementById("root");
if (!root) throw new Error("app: missing #root");
createRoot(root).render(
  <StrictMode>
    <AppShell
      model={{
        route: "onboarding",
        popup,
        activity: [],
        settings: defaultSettings(),
        onboarding: onboardingFor("entry"),
      }}
    />
  </StrictMode>,
);
