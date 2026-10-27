// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { initialOnboarding, isOnboardingComplete, transition } from "../onboarding.js";
import {
  answerQuizChallenge,
  buildQuizChallenge,
  onboardingProgress,
  passwordMeter,
  type PasswordStrengthLike,
} from "./onboarding.js";

const WORDS = [
  "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
  "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
  "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
];

function fakeCheck(pw: string): PasswordStrengthLike {
  return {
    score: pw.length >= 14 ? 4 : pw.length >= 8 ? 2 : 0,
    minLengthOk: pw.length >= 8,
    classCount: 2,
    feedback: pw.includes("password") ? ["too common — avoid dictionary words"] : ["longer passwords are stronger"],
    passesForNewWallet: pw.length >= 14,
  };
}

describe("onboarding screen VM", () => {
  it("meters passwords with i18n keys", () => {
    expect(passwordMeter("", fakeCheck)).toEqual({ score: 0, canContinue: false, feedbackKeys: ["password.tooShort"] });
    expect(passwordMeter("short", fakeCheck).feedbackKeys).toEqual(["password.tooShort"]);
    const weak = passwordMeter("longenough", fakeCheck);
    expect(weak.canContinue).toBe(false);
    expect(weak.feedbackKeys).toEqual(["password.tooCommon"]);
    const strong = passwordMeter("correct horse battery staple 123!", fakeCheck);
    expect(strong).toEqual({ score: 4, canContinue: true, feedbackKeys: ["password.strong"] });
  });

  it("builds deterministic distinct 3-option quizzes", () => {
    const c0 = buildQuizChallenge(WORDS, 0);
    expect(c0.expected).toBe("abandon");
    expect(new Set(c0.options).size).toBe(3);
    expect(c0.options).toContain("abandon");
    expect(c0.promptKey).toBe("onboarding.quizPrompt");
    // Deterministic: same inputs, same options; placement rotates with index.
    expect(buildQuizChallenge(WORDS, 0).options).toEqual(c0.options);
    expect(buildQuizChallenge(WORDS, 3).options).not.toEqual(buildQuizChallenge(WORDS, 4).options);
    expect(() => buildQuizChallenge(WORDS.slice(0, 4), 0)).toThrow();
    expect(() => buildQuizChallenge(WORDS, 99)).toThrow();
  });

  it("answers drive the state machine to done", () => {
    let s = initialOnboarding();
    s = transition(s, { type: "start" });
    s = transition(s, { type: "choose", method: "create" });
    s = transition(s, { type: "submitPassword", ok: true });
    s = transition(s, { type: "confirmSeedSaved" });
    const c = buildQuizChallenge(WORDS, 2);
    s = answerQuizChallenge(s, "wrong-word", c);
    expect(s.step).toBe("backupQuiz");
    expect(s.attempts).toBe(1);
    s = answerQuizChallenge(s, c.expected, c);
    expect(isOnboardingComplete(s)).toBe(true);
  });

  it("tracks progress through the steps", () => {
    expect(onboardingProgress(initialOnboarding())).toEqual({ stepIndex: 0, totalSteps: 6 });
    const s1 = transition(initialOnboarding(), { type: "start" });
    expect(onboardingProgress(s1).stepIndex).toBe(1);
    expect(onboardingProgress({ ...s1, step: "showSeed" }).stepIndex).toBe(3);
    expect(onboardingProgress({ ...s1, step: "enterSeed" }).stepIndex).toBe(3);
    expect(onboardingProgress({ ...s1, step: "done" })).toEqual({ stepIndex: 5, totalSteps: 6 });
  });
});
