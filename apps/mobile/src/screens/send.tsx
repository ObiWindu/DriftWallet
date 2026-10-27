// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

// Send screen shell (U012). Local text state only; validation via `./send.ts`.

export type ShellFeeLevel = "low" | "med" | "high";

export interface SendShellTier {
  level: ShellFeeLevel;
  fiat: string;
}

export interface SendScreenProps {
  errorKey: string | null;
  tiers: SendShellTier[];
  feeLevel: ShellFeeLevel;
  biometricRequired: boolean;
  t: (key: string) => string;
  onSubmit: (form: { to: string; amountText: string; feeLevel: ShellFeeLevel }) => void;
  onFormChange?: (form: { to: string; amountText: string }) => void;
}

export function SendScreen(props: SendScreenProps) {
  const [to, setTo] = useState("");
  const [amountText, setAmountText] = useState("");
  const [feeLevel, setFeeLevel] = useState<ShellFeeLevel>(props.feeLevel);
  const changeTo = (v: string) => {
    setTo(v);
    props.onFormChange?.({ to: v, amountText });
  };
  const changeAmount = (v: string) => {
    setAmountText(v);
    props.onFormChange?.({ to, amountText: v });
  };
  return (
    <View testID="screen-send">
      <Text testID="send-title">{props.t("send.title")}</Text>
      <TextInput testID="send-to" accessibilityLabel={props.t("send.to")} value={to} onChangeText={changeTo} />
      <TextInput
        testID="send-amount"
        accessibilityLabel={props.t("send.amount")}
        value={amountText}
        onChangeText={changeAmount}
      />
      {props.errorKey ? <Text testID="send-error">{props.t(props.errorKey)}</Text> : null}
      <View testID="send-fees">
        {props.tiers.map((tier) => (
          <Pressable key={tier.level} testID={`fee-${tier.level}`} onPress={() => setFeeLevel(tier.level)}>
            <Text>
              {props.t(`fee.${tier.level}`)} · {tier.fiat}
              {feeLevel === tier.level ? " ✓" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {props.biometricRequired ? (
        <Text testID="send-biometric-hint">{props.t("send.biometricRequired")}</Text>
      ) : null}
      <Pressable
        testID="send-submit"
        accessibilityLabel={props.t("send.confirm")}
        onPress={() => props.onSubmit({ to, amountText, feeLevel })}
      >
        <Text>{props.t("send.confirm")}</Text>
      </Pressable>
    </View>
  );
}
