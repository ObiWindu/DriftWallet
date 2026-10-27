// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Onboarding state machine (T009). Pure functions — no native deps.
// Flow: welcome -> createOrImport -> (create: showSeed -> backupQuiz | import: enterSeed -> backupQuiz) -> done
// Password/Biometric steps are tracked via flags so the machine stays UI-agnostic.

export type OnboardingMethod = "create" | "import";

export type OnboardingStep =
  | "welcome"
  | "createOrImport"
  | "createPassword"
  | "showSeed"
  | "enterSeed"
  | "backupQuiz"
  | "done";

export interface OnboardingState {
  step: OnboardingStep;
  method: OnboardingMethod | null;
  passwordSet: boolean;
  seedConfirmed: boolean;
  quizPassed: boolean;
  attempts: number;
}

export type OnboardingAction =
  | { type: "start" }
  | { type: "choose"; method: OnboardingMethod }
  | { type: "submitPassword"; ok: boolean }
  | { type: "confirmSeedSaved" }
  | { type: "submitImportedSeed"; ok: boolean }
  | { type: "answerQuiz"; correct: boolean }
  | { type: "reset" };

export function initialOnboarding(): OnboardingState {
  return {
    step: "welcome",
    method: null,
    passwordSet: false,
    seedConfirmed: false,
    quizPassed: false,
    attempts: 0,
  };
}

export function transition(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "start":
      if (state.step !== "welcome") return state;
      return { ...state, step: "createOrImport" };
    case "choose":
      if (state.step !== "createOrImport") return state;
      return { ...state, method: action.method, step: "createPassword" };
    case "submitPassword":
      if (state.step !== "createPassword" || !action.ok) return state;
      return {
        ...state,
        passwordSet: true,
        step: state.method === "import" ? "enterSeed" : "showSeed",
      };
    case "confirmSeedSaved":
      if (state.step !== "showSeed") return state;
      return { ...state, seedConfirmed: true, step: "backupQuiz" };
    case "submitImportedSeed":
      if (state.step !== "enterSeed" || !action.ok) return state;
      return { ...state, seedConfirmed: true, step: "backupQuiz" };
    case "answerQuiz":
      if (state.step !== "backupQuiz") return state;
      if (action.correct) return { ...state, quizPassed: true, step: "done" };
      return { ...state, attempts: state.attempts + 1 };
    case "reset":
      return initialOnboarding();
    default:
      return state;
  }
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return state.step === "done" && state.passwordSet && state.seedConfirmed && state.quizPassed;
}
