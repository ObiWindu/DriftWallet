// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { Text, View } from "react-native";

// Root component (U010–U013 wiring): a lightweight state-based navigator over
// ROUTE_DEFS — React Navigation consumes the same route map in the native
// shell. The watch-only banner is persistent and sign routes are gated so a
// watch-only account never sees a sign CTA (I012).
import { ROUTE_DEFS, canVisit, initialRoute, type RouteName } from "./navigation.js";
import { createWalletStore } from "./store.js";
import { createUseWalletStore } from "./store-react.js";
import { HomeScreen } from "./screens/home.tsx";
import { assetRows, chainTabs, homeBanner, portfolioSummary } from "./screens/home.js";
import type { AssetBalance } from "./screens/home.js";
import { SendScreen } from "./screens/send.tsx";
import type { ShellFeeLevel } from "./screens/send.tsx";
import { ReceiveScreen } from "./screens/receive.tsx";
import { truncateMiddle } from "./screens/receive.js";
import { ActivityScreen } from "./screens/activity.tsx";
import { SettingsScreen } from "./screens/settings.tsx";
import { autoLockPresets } from "./screens/settings.js";
import { OnboardingScreen } from "./screens/onboarding.tsx";

const store = createWalletStore();
const useWalletStore = createUseWalletStore(store);

// Identity translator for the shell; localized strings land with I059
// (i18next + expo-localization) — keys are self-describing until then.
const t = (key: string): string => key;

export interface AppProps {
  hasWallet?: boolean;
  watchOnly?: boolean;
  /** Test/preview hook: start with an unlocked session (store.unlock in prod). */
  unlocked?: boolean;
  balances?: AssetBalance[];
  address?: string;
  mainnetEnabled?: boolean;
}

export default function App(props: AppProps) {
  const hasWallet = props.hasWallet ?? false;
  const watchOnly = props.watchOnly ?? false;
  const [route, setRoute] = useState<RouteName>(props.unlocked === true ? "Home" : initialRoute(hasWallet));
  const lock = useWalletStore((s) => s.lock);
  const selectedChain = useWalletStore((s) => s.selectedChain);
  const selectChain = useWalletStore((s) => s.selectChain);
  const autoLockMs = useWalletStore((s) => s.autoLockMs);
  const setAutoLockMs = useWalletStore((s) => s.setAutoLockMs);
  const [hideSpam, setHideSpam] = useState(false);
  const [wipeErrorKey, setWipeErrorKey] = useState<string | null>(null);

  const authenticated = lock.status === "unlocked" || props.unlocked === true;
  // Watch-only accounts must never reach an auth-gated sign route.
  const navigate = (next: RouteName): void => {
    if (watchOnly && ROUTE_DEFS[next].requiresAuth && next === "Send") {
      setRoute("Home");
      return;
    }
    if (!canVisit(next, authenticated)) {
      setRoute(initialRoute(hasWallet));
      return;
    }
    setRoute(next);
  };

  const balances = props.balances ?? [];
  const summary = portfolioSummary(balances);
  const address = props.address ?? "";

  return (
    <View testID="app-root">
      {watchOnly ? (
        <Text testID="watch-only-banner" accessibilityLabel={t("watchOnly.banner")}>
          {t("watchOnly.banner")}
        </Text>
      ) : null}
      {route === "Onboarding" ? (
        <OnboardingScreen
          titleKey="onboarding.title"
          primaryKey="onboarding.create"
          t={t}
          onPrimary={() => navigate("Home")}
        />
      ) : null}
      {route === "Home" ? (
        <HomeScreen
          totalFiat={summary.totalFiat}
          rows={assetRows(balances).map((r) => ({ ...r }))}
          tabs={chainTabs(selectedChain).map((c) => ({ ...c }))}
          bannerKey={homeBanner(props.mainnetEnabled ?? true)?.bannerKey ?? null}
          emptyKey={summary.emptyKey}
          refreshing={false}
          t={t}
          onSelectChain={(chainId) => selectChain(chainId)}
          onRefresh={() => undefined}
        />
      ) : null}
      {route === "Send" && !watchOnly ? (
        <SendScreen
          errorKey={null}
          tiers={(["low", "med", "high"] as ShellFeeLevel[]).map((level) => ({ level, fiat: "$0.00" }))}
          feeLevel="med"
          biometricRequired={false}
          t={t}
          onSubmit={() => undefined}
        />
      ) : null}
      {route === "Receive" ? (
        <ReceiveScreen
          truncated={truncateMiddle(address)}
          copyKey="receive.copy"
          shareKey="receive.share"
          t={t}
          onCopy={() => undefined}
          onShare={() => undefined}
        />
      ) : null}
      {route === "Activity" ? (
        <ActivityScreen
          rows={[]}
          emptyKey="activity.empty"
          hideSpam={hideSpam}
          spamToggleKey="activity.hideSpam"
          t={t}
          onToggleSpam={() => setHideSpam((v) => !v)}
        />
      ) : null}
      {route === "Settings" ? (
        <SettingsScreen
          autoLockMs={autoLockMs}
          presets={autoLockPresets()}
          biometricOn={false}
          networkId={props.mainnetEnabled === false ? "testnet" : "mainnet"}
          wipeErrorKey={wipeErrorKey}
          t={t}
          onAutoLock={(ms) => setAutoLockMs(ms)}
          onBiometric={() => undefined}
          onNetwork={() => undefined}
          onExport={() => undefined}
          onWipeInput={() => setWipeErrorKey(null)}
        />
      ) : null}
      <View testID="app-tabbar">
        {(["Home", "Receive", "Send", "Activity", "Settings"] as RouteName[]).map((name) => (
          <Text key={name} testID={`tab-${name.toLowerCase()}`} onPress={() => navigate(name)}>
            {name}
          </Text>
        ))}
      </View>
    </View>
  );
}
