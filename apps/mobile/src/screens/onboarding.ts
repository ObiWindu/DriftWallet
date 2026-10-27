// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { transition, type OnboardingState } from "../onboarding.js";

// Onboarding screen view-model (U010). Extends the `onboarding.ts` state
// machine with presentation logic: password metering, deterministic backup
// quiz, and progress. Pure functions — no native deps.
//
// Password checking is injected with the @drift/keystore `checkPasswordStrength`
// shape (read-only contract; mirrored locally to avoid cross-package imports):
export interface PasswordStrengthLike {
  score: 0 | 1 | 2 | 3 | 4;
  minLengthOk: boolean;
  classCount: number;
  feedback: string[];
  passesForNewWallet: boolean;
}

export interface PasswordMeter {
  score: 0 | 1 | 2 | 3 | 4;
  canContinue: boolean;
  /** i18n keys driving the strength hints under the password field. */
  feedbackKeys: string[];
}

export function passwordMeter(
  password: string,
  check: (pw: string) => PasswordStrengthLike,
): PasswordMeter {
  const pw = z.string().max(1024).parse(password);
  if (pw.length === 0) return { score: 0, canContinue: false, feedbackKeys: ["password.tooShort"] };
  const s = check(pw);
  if (!s.minLengthOk) return { score: s.score, canContinue: false, feedbackKeys: ["password.tooShort"] };
  if (s.passesForNewWallet) return { score: s.score, canContinue: true, feedbackKeys: ["password.strong"] };
  const keys = s.feedback.some((f) => /common/i.test(f)) ? ["password.tooCommon"] : ["password.tooCommon"];
  return { score: s.score, canContinue: false, feedbackKeys: keys };
}

// ---------------------------------------------------------------------------
// Backup quiz: deterministic 3-option challenge over the seed words.
// ---------------------------------------------------------------------------

export const SeedWordsSchema = z.array(z.string().regex(/^[a-z]+$/)).min(12).max(24);

export interface QuizChallenge {
  quizIndex: number;
  promptKey: "onboarding.quizPrompt";
  options: [string, string, string];
  expected: string;
}

/**
 * Build the quiz challenge for word `quizIndex`. Decoys are the next two
 * distinct words (cyclic); placement rotates by `quizIndex % 3` so it is
 * deterministic and unit-testable (no Math.random near secrets UX).
 */
export function buildQuizChallenge(words: string[], quizIndex: number): QuizChallenge {
  const list = SeedWordsSchema.parse(words);
  const idx = z.number().int().min(0).parse(quizIndex);
  if (idx >= list.length) throw new Error("quiz index out of range");
  const expected = list[idx] as string;
  const decoys: string[] = [];
  for (let k = 1; k <= list.length && decoys.length < 2; k++) {
    const w = list[(idx + k) % list.length] as string;
    if (w !== expected && !decoys.includes(w)) decoys.push(w);
  }
  if (decoys.length < 2) throw new Error("not enough distinct words");
  const triple = [expected, decoys[0] as string, decoys[1] as string] as [string, string, string];
  const rot = idx % 3;
  const options = [triple[rot] as string, triple[(rot + 1) % 3] as string, triple[(rot + 2) % 3] as string] as [
    string,
    string,
    string,
  ];
  return { quizIndex: idx, promptKey: "onboarding.quizPrompt", options, expected };
}

export function answerQuizChallenge(
  state: OnboardingState,
  picked: string,
  challenge: QuizChallenge,
): OnboardingState {
  z.string().parse(picked);
  return transition(state, { type: "answerQuiz", correct: picked === challenge.expected });
}

// ---------------------------------------------------------------------------
// Progress indicator.
// ---------------------------------------------------------------------------

const STEP_ORDER = ["welcome", "createOrImport", "createPassword", "seed", "backupQuiz", "done"] as const;

export function onboardingProgress(state: OnboardingState): { stepIndex: number; totalSteps: number } {
  const key = state.step === "showSeed" || state.step === "enterSeed" ? "seed" : state.step;
  return { stepIndex: STEP_ORDER.indexOf(key as (typeof STEP_ORDER)[number]), totalSteps: STEP_ORDER.length };
}
