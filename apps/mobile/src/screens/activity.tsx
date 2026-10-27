// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { Pressable, Text, View } from "react-native";

// Activity screen shell (U013). Rows come from `./activity.ts`.

export interface ActivityShellRow {
  id: string;
  statusKey: string;
  amount: string;
  explorerUrl: string | null;
}

export interface ActivityScreenProps {
  rows: ActivityShellRow[];
  emptyKey: string | null;
  hideSpam: boolean;
  spamToggleKey: string;
  t: (key: string) => string;
  onToggleSpam: () => void;
  onOpenExplorer?: (url: string) => void;
}

export function ActivityScreen(props: ActivityScreenProps) {
  return (
    <View testID="screen-activity">
      <Text testID="activity-title">{props.t("activity.title")}</Text>
      <Pressable testID="activity-spam-toggle" onPress={props.onToggleSpam}>
        <Text>
          {props.t(props.spamToggleKey)}: {props.hideSpam ? "✓" : "✗"}
        </Text>
      </Pressable>
      {props.emptyKey ? (
        <Text testID="activity-empty">{props.t(props.emptyKey)}</Text>
      ) : (
        <View testID="activity-list">
          {props.rows.map((r) => (
            <View key={r.id} testID={`activity-${r.id}`}>
              <Text>{r.amount}</Text>
              <Text>{props.t(r.statusKey)}</Text>
              {r.explorerUrl ? (
                <Pressable testID={`explorer-${r.id}`} onPress={() => props.onOpenExplorer?.(r.explorerUrl as string)}>
                  <Text>{r.explorerUrl}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
