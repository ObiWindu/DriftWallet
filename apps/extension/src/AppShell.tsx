// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Full-page app shell (U022): onboarding / home / activity / settings.
// Thin renderer over the app-model + popup view-model; routing state comes
// from navigation.ts. All logic + tests live in .ts modules.
import type { JSX } from "react";
import type { FullPageModel } from "./app-model.js";
import { visibleActivity } from "./app-model.js";
import { createExtensionI18n, type SupportedLocale } from "./i18n.js";
import { ChainBadge, ThemeProvider } from "./components.js";
import type { ThemeMode } from "./theme.js";
import { PopupShell } from "./PopupView.js";

export interface AppShellProps {
  model: FullPageModel;
  locale?: SupportedLocale | undefined;
  theme?: ThemeMode | undefined;
  onNavigate?: ((route: FullPageModel["route"]) => void) | undefined;
  onBack?: (() => void) | undefined;
}

const ROUTES = ["onboarding", "home", "activity", "settings"] as const;

export function AppShell(props: AppShellProps): JSX.Element {
  const t = createExtensionI18n(props.locale ?? "en").t;
  const m = props.model;
  return (
    <ThemeProvider mode={props.theme ?? "light"}>
      <div>
        <nav aria-label="primary">
          {ROUTES.map((r) => (
            <button key={r} aria-current={m.route === r ? "page" : undefined} onClick={() => props.onNavigate?.(r)}>
              {r}
            </button>
          ))}
        </nav>
        {m.route === "onboarding" && (
          <section aria-label="onboarding">
            <h2>{m.onboarding.step}</h2>
            <progress value={m.onboarding.progress} max={1} aria-label="onboarding progress" />
          </section>
        )}
        {m.route === "home" && <PopupShell model={m.popup} locale={props.locale} theme={props.theme} />}
        {m.route === "activity" && (
          <section aria-label="activity">
            <ul>
              {visibleActivity(m.activity, m.settings).map((item) => (
                <li key={item.id}>
                  <ChainBadge chain={item.chain} /> {item.kind} · {item.status} · {item.txHash}
                </li>
              ))}
            </ul>
          </section>
        )}
        {m.route === "settings" && (
          <section aria-label={t("settings.title")}>
            <h2>{t("settings.title")}</h2>
            <div>
              {t("settings.autoLock")}: {m.settings.autoLockSecs}s
            </div>
            <div>
              {t("settings.testnet")}: {m.settings.testnet ? "on" : "off"}
            </div>
            <div>
              {t("settings.spamHide")}: {m.settings.spamHide ? "on" : "off"}
            </div>
          </section>
        )}
      </div>
    </ThemeProvider>
  );
}
