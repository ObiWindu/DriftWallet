// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

// Settings screen shell (U014). Local input state only; rules in `./settings.ts`.

export interface SettingsScreenProps {
  autoLockMs: number;
  presets: number[];
  biometricOn: boolean;
  networkId: "mainnet" | "testnet";
  wipeErrorKey: string | null;
  t: (key: string) => string;
  onAutoLock: (ms: number) => void;
  onBiometric: (on: boolean) => void;
  onNetwork: (id: "mainnet" | "testnet") => void;
  onExport: () => void;
  onWipeInput: (text: string) => void;
}

export function SettingsScreen(props: SettingsScreenProps) {
  const [wipe, setWipe] = useState("");
  const changeWipe = (v: string) => {
    setWipe(v);
    props.onWipeInput(v);
  };
  return (
    <View testID="screen-settings">
      <Text testID="settings-title">{props.t("settings.title")}</Text>
      <View testID="settings-autolock">
        <Text>{props.t("settings.autoLock")}</Text>
        {props.presets.map((ms) => (
          <Pressable key={ms} testID={`autolock-${ms}`} onPress={() => props.onAutoLock(ms)}>
            <Text>
              {ms / 1000}s{props.autoLockMs === ms ? " ✓" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable testID="settings-biometric" onPress={() => props.onBiometric(!props.biometricOn)}>
        <Text>
          {props.t("settings.biometric")}: {props.biometricOn ? "✓" : "✗"}
        </Text>
      </Pressable>
      <View testID="settings-network">
        <Text>{props.t("settings.network")}</Text>
        {(["mainnet", "testnet"] as const).map((id) => (
          <Pressable key={id} testID={`network-${id}`} onPress={() => props.onNetwork(id)}>
            <Text>
              {props.t(`settings.${id}`)}
              {props.networkId === id ? " ✓" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable testID="settings-export" onPress={props.onExport}>
        <Text>{props.t("settings.exportSeed")}</Text>
      </Pressable>
      <TextInput
        testID="settings-wipe-input"
        accessibilityLabel={props.t("settings.wipeConfirm")}
        value={wipe}
        onChangeText={changeWipe}
      />
      {props.wipeErrorKey ? <Text testID="settings-wipe-error">{props.t(props.wipeErrorKey)}</Text> : null}
    </View>
  );
}
