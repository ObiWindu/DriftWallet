// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { Pressable, Text, View } from "react-native";

// Receive screen shell (U012). Shows the address + QR payload placeholder.

export interface ReceiveScreenProps {
  truncated: string;
  copyKey: string;
  shareKey: string;
  t: (key: string) => string;
  onCopy: () => void;
  onShare: () => void;
}

export function ReceiveScreen(props: ReceiveScreenProps) {
  return (
    <View testID="screen-receive">
      <Text testID="receive-title">{props.t("receive.title")}</Text>
      <Text testID="receive-address">{props.truncated}</Text>
      <Pressable testID="receive-copy" accessibilityLabel={props.t(props.copyKey)} onPress={props.onCopy}>
        <Text>{props.t(props.copyKey)}</Text>
      </Pressable>
      <Pressable testID="receive-share" accessibilityLabel={props.t(props.shareKey)} onPress={props.onShare}>
        <Text>{props.t(props.shareKey)}</Text>
      </Pressable>
    </View>
  );
}
