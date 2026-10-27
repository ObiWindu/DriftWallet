// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { Pressable, Text, View } from "react-native";

// Home screen shell (U011). Presentational only; totals/rows/tabs come from
// `./home.ts`.

export interface HomeShellRow {
  chainId: string;
  symbol: string;
  amount: string;
  fiat: string;
}

export interface HomeShellTab {
  chainId: string;
  label: string;
  selected: boolean;
}

export interface HomeScreenProps {
  totalFiat: string;
  rows: HomeShellRow[];
  tabs: HomeShellTab[];
  bannerKey: string | null;
  emptyKey: string | null;
  refreshing: boolean;
  t: (key: string) => string;
  onSelectChain: (chainId: string) => void;
  onRefresh: () => void;
}

export function HomeScreen(props: HomeScreenProps) {
  return (
    <View testID="screen-home">
      <Text testID="home-portfolio-label">{props.t("home.portfolio")}</Text>
      <Text testID="home-total">{props.totalFiat}</Text>
      {props.bannerKey ? <Text testID="home-banner">{props.t(props.bannerKey)}</Text> : null}
      <View testID="home-tabs">
        {props.tabs.map((tab) => (
          <Pressable key={tab.chainId} testID={`tab-${tab.chainId}`} onPress={() => props.onSelectChain(tab.chainId)}>
            <Text>
              {tab.label}
              {tab.selected ? " ✓" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {props.emptyKey ? (
        <Text testID="home-empty">{props.t(props.emptyKey)}</Text>
      ) : (
        <View testID="home-assets">
          {props.rows.map((r) => (
            <View key={`${r.chainId}-${r.symbol}`} testID={`asset-${r.symbol}`}>
              <Text>{r.amount}</Text>
              <Text>{r.fiat}</Text>
            </View>
          ))}
        </View>
      )}
      <Pressable testID="home-refresh" accessibilityLabel={props.t("home.refresh")} onPress={props.onRefresh}>
        <Text>{props.refreshing ? "…" : props.t("home.refresh")}</Text>
      </Pressable>
    </View>
  );
}
