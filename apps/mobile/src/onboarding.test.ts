// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { initialOnboarding, isOnboardingComplete, transition } from "./onboarding.js";

describe("onboarding state machine", () => {
  it("completes the create flow", () => {
    let s = initialOnboarding();
    s = transition(s, { type: "start" });
    s = transition(s, { type: "choose", method: "create" });
    s = transition(s, { type: "submitPassword", ok: true });
    expect(s.step).toBe("showSeed");
    s = transition(s, { type: "confirmSeedSaved" });
    expect(s.step).toBe("backupQuiz");
    s = transition(s, { type: "answerQuiz", correct: true });
    expect(isOnboardingComplete(s)).toBe(true);
  });

  it("completes the import flow", () => {
    let s = initialOnboarding();
    s = transition(s, { type: "start" });
    s = transition(s, { type: "choose", method: "import" });
    s = transition(s, { type: "submitPassword", ok: true });
    expect(s.step).toBe("enterSeed");
    s = transition(s, { type: "submitImportedSeed", ok: false });
    expect(s.step).toBe("enterSeed");
    s = transition(s, { type: "submitImportedSeed", ok: true });
    s = transition(s, { type: "answerQuiz", correct: false });
    expect(s.step).toBe("backupQuiz");
    expect(s.attempts).toBe(1);
    s = transition(s, { type: "answerQuiz", correct: true });
    expect(isOnboardingComplete(s)).toBe(true);
  });

  it("rejects out-of-order actions", () => {
    const s = initialOnboarding();
    expect(transition(s, { type: "confirmSeedSaved" }).step).toBe("welcome");
    expect(transition(s, { type: "reset" }).step).toBe("welcome");
  });
});
