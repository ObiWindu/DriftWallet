// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Popup shell (U020): portfolio mini, network picker, connect status,
// approve CTA badge. Thin renderer over `buildPopupView` (popup-view.ts);
// all logic + tests live there.
import type { JSX } from "react";
import { approveBadge } from "./popup-view.js";
import type { PopupViewModel } from "./popup-view.js";
import { createExtensionI18n, type SupportedLocale } from "./i18n.js";
import { AddressRow, ChainBadge, ThemeProvider } from "./components.js";
import type { ThemeMode } from "./theme.js";

export interface PopupShellProps {
  model: PopupViewModel;
  locale?: SupportedLocale | undefined;
  theme?: ThemeMode | undefined;
  onOpenFullPage?: (() => void) | undefined;
  onSelectNetwork?: ((id: string) => void) | undefined;
}

export function PopupShell(props: PopupShellProps): JSX.Element {
  const t = createExtensionI18n(props.locale ?? "en").t;
  const m = props.model;
  return (
    <ThemeProvider mode={props.theme ?? "light"}>
      <main aria-label={t("popup.title")}>
        <h1>{t("popup.title")}</h1>
        <section aria-label={t("popup.portfolio")}>
          <div data-testid="portfolio-total">${m.portfolio.totalUsd}</div>
          <ul>
            {m.portfolio.rows.map((row) => (
              <li key={`${row.chain}:${row.symbol}`}>
                <ChainBadge chain={row.chain} />
                <span>{row.symbol}</span> <span>{row.balance}</span> <span>${row.valueUsd}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="networks">
          <select
            aria-label="network"
            value={m.selectedNetwork.id}
            onChange={(e) => props.onSelectNetwork?.((e.target as HTMLSelectElement).value)}
          >
            {m.networks
              .filter((n) => n.enabled)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
          </select>
        </section>
        <section aria-label="connections">
          <span data-testid="connected-count">{m.connectedCount}</span>
          <ul>
            {m.connectedOrigins.map((o) => (
              <li key={o.origin}>
                <AddressRow address={o.origin} />
              </li>
            ))}
          </ul>
        </section>
        <button data-testid="approve-cta" onClick={() => props.onOpenFullPage?.()}>
          {t("popup.approve", { count: m.pendingCount })} {approveBadge(m.pendingCount)}
        </button>
      </main>
    </ThemeProvider>
  );
}
