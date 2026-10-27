// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import i18next, { type i18n as I18n } from "i18next";
import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };

// i18n (U001). EN is complete; FR/ES are partial and fall back to EN.
// All user-visible strings in @drift/ui and mobile screens go through keys.
// Import attributes for JSON require TS `resolveJsonModule` (on in base config).

export type SupportedLng = "en" | "fr" | "es";
export const SUPPORTED_LNGS: SupportedLng[] = ["en", "fr", "es"];

type Dict = Record<string, string>;
const resources: Record<SupportedLng, Dict> = {
  en: en as Dict,
  fr: fr as Dict,
  es: es as Dict,
};

export function translate(lng: string, key: string): string {
  const dict = (resources as Record<string, Dict>)[lng];
  return dict?.[key] ?? (resources.en as Dict)[key] ?? key;
}

export type TFunction = (key: string) => string;
export function tFor(lng: string): TFunction {
  return (key: string) => translate(lng, key);
}

let instance: I18n | null = null;

/** Shared i18next instance for app shells (React bindings attach in shells). */
export async function getI18n(lng: SupportedLng = "en"): Promise<I18n> {
  if (instance) {
    await instance.changeLanguage(lng);
    return instance;
  }
  instance = i18next.createInstance();
  await instance.init({
    lng,
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LNGS,
    resources: {
      en: { translation: resources.en },
      fr: { translation: resources.fr },
      es: { translation: resources.es },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}

/** Every EN key must resolve; FR/ES fall back to EN per key. */
export function enKeys(): string[] {
  return Object.keys(resources.en);
}
