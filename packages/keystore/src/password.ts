// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

export const PasswordSchema = z.string().min(8);

export interface PasswordClasses {
  lower: boolean;
  upper: boolean;
  digit: boolean;
  symbol: boolean;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  minLengthOk: boolean;
  classes: PasswordClasses;
  classCount: number;
  feedback: string[];
  passesForNewWallet: boolean;
}

const COMMON = [
  "password", "123456", "12345678", "qwerty", "letmein", "welcome",
  "monkey", "dragon", "123456789", "abc123", "111111", "123123",
  "admin", "login", "passw0rd",
];

function classesOf(pw: string): PasswordClasses {
  return {
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    digit: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
}

export function checkPasswordStrength(password: string): PasswordStrength {
  const pw = z.string().parse(password);
  const feedback: string[] = [];
  const minLengthOk = pw.length >= 8;
  const classes = classesOf(pw);
  const classCount = [classes.lower, classes.upper, classes.digit, classes.symbol].filter(Boolean).length;

  if (!minLengthOk) {
    feedback.push("use at least 8 characters");
    return { score: 0, minLengthOk, classes, classCount, feedback, passesForNewWallet: false };
  }

  let score = 0;
  score += 1; // length >= 8
  if (pw.length >= 12) score += 1;
  if (classCount >= 2) score += 1;
  if (classCount >= 3 && pw.length >= 10) score += 1;
  if (classCount === 4 && pw.length >= 14) score += 1;
  score = Math.min(4, score);

  // zxcvbn-lite penalties (no network, no dictionary download)
  const lower = pw.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) {
    score = Math.max(0, score - 2) as PasswordStrength["score"];
    feedback.push("too common — avoid dictionary words and sequences");
  }
  if (/(.)\1{2,}/.test(pw)) {
    score = Math.max(0, score - 1) as PasswordStrength["score"];
    feedback.push("avoid repeated characters");
  }
  if (/0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef/i.test(pw)) {
    score = Math.max(0, score - 1) as PasswordStrength["score"];
    feedback.push("avoid sequences like 1234 or abcd");
  }
  if (classCount < 2) feedback.push("mix character classes (upper, lower, digits, symbols)");
  if (pw.length < 12) feedback.push("longer passwords are stronger (12+ recommended)");
  if (score >= 3 && feedback.length === 0) feedback.push("strong password");

  const clamped = Math.max(0, Math.min(4, score)) as PasswordStrength["score"];
  return {
    score: clamped,
    minLengthOk,
    classes,
    classCount,
    feedback,
    passesForNewWallet: minLengthOk && clamped >= 3,
  };
}

export function assertStrongForNewWallet(password: string): void {
  const r = checkPasswordStrength(password);
  if (!r.passesForNewWallet) {
    throw new Error(`password too weak (score ${r.score}/4): ${r.feedback.join("; ")}`);
  }
}
