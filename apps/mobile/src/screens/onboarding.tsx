// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

// Onboarding screen shell (U010). Presentational only: all logic lives in
// `./onboarding.ts`; strings arrive as i18n keys via `t`.

export interface OnboardingShellMeter {
  score: number;
  canContinue: boolean;
  feedbackKeys: string[];
}

export interface OnboardingShellQuiz {
  promptKey: string;
  options: string[];
}

export interface OnboardingScreenProps {
  titleKey: string;
  primaryKey: string;
  t: (key: string) => string;
  onPrimary: () => void;
  initialPassword?: string;
  onPasswordChange?: (pw: string) => void;
  meter?: OnboardingShellMeter;
  quiz?: OnboardingShellQuiz | null;
  onQuizPick?: (option: string) => void;
}

export function OnboardingScreen(props: OnboardingScreenProps) {
  const [password, setPassword] = useState(props.initialPassword ?? "");
  const change = (pw: string) => {
    setPassword(pw);
    props.onPasswordChange?.(pw);
  };
  return (
    <View testID="screen-onboarding">
      <Text testID="onboarding-title">{props.t(props.titleKey)}</Text>
      <TextInput
        testID="onboarding-password"
        accessibilityLabel={props.t("onboarding.setPassword")}
        secureTextEntry
        value={password}
        onChangeText={change}
      />
      {props.meter
        ? props.meter.feedbackKeys.map((k) => (
            <Text key={k} testID={`meter-${k}`}>
              {props.t(k)}
            </Text>
          ))
        : null}
      {props.quiz ? (
        <View testID="onboarding-quiz">
          <Text testID="quiz-prompt">{props.t(props.quiz.promptKey)}</Text>
          {props.quiz.options.map((o, i) => (
            <Pressable key={o} testID={`word-${i}`} onPress={() => props.onQuizPick?.(o)}>
              <Text>{o}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Pressable testID="onboarding-primary" accessibilityLabel={props.t(props.primaryKey)} onPress={props.onPrimary}>
        <Text>{props.t(props.primaryKey)}</Text>
      </Pressable>
    </View>
  );
}
