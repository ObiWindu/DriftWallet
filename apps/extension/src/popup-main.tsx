// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Popup entry: mounts PopupShell in a locked, empty state.
// No key material, no sessions, no fetch — the live SW fills state later
// via storage + runtime messages. This bundle must stay dependency-light.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PopupShell } from "./PopupView.js";
import { buildPopupView } from "./popup-view.js";

const NETWORKS = [
  { id: "eip155:1", label: "Ethereum", testnet: false, enabled: true },
  { id: "solana:mainnet", label: "Solana", testnet: false, enabled: true },
  { id: "bip122:000000000019d6689c085ae165831e93", label: "Bitcoin", testnet: false, enabled: true },
  { id: "cardano:mainnet", label: "Cardano", testnet: false, enabled: true },
];

const model = buildPopupView({
  assets: [],
  networks: NETWORKS,
  selectedNetwork: "eip155:1",
  connectedOrigins: [],
  approvalQueue: [],
});

const root = document.getElementById("root");
if (!root) throw new Error("popup: missing #root");
createRoot(root).render(
  <StrictMode>
    <PopupShell model={model} />
  </StrictMode>,
);
