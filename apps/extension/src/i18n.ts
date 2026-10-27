// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Extension-localized strings (EN/FR/ES) via i18next (U020/U022).
// All user-facing extension copy lives here as keys from day one.
import { createInstance, type i18n } from "i18next";

const en = {
  popup: { title: "DriftWallet", portfolio: "Portfolio", approve: "Review ({{count}})", connect: "Connect" },
  approval: {
    title: "Review request",
    approve: "Approve",
    reject: "Reject",
    alwaysAsk: "Always ask",
    autoReject: "Auto-reject this site",
  },
  settings: { title: "Settings", autoLock: "Auto-lock", testnet: "Testnet mode", spamHide: "Hide spam tokens" },
  common: { cancel: "Cancel", confirm: "Confirm", back: "Back", close: "Close" },
};

type Strings = typeof en;

const fr: Strings = {
  popup: { title: "DriftWallet", portfolio: "Portefeuille", approve: "Vérifier ({{count}})", connect: "Connecter" },
  approval: {
    title: "Vérifier la demande",
    approve: "Approuver",
    reject: "Rejeter",
    alwaysAsk: "Toujours demander",
    autoReject: "Rejeter ce site",
  },
  settings: { title: "Paramètres", autoLock: "Verrouillage auto", testnet: "Mode testnet", spamHide: "Masquer les spams" },
  common: { cancel: "Annuler", confirm: "Confirmer", back: "Retour", close: "Fermer" },
};

const es: Strings = {
  popup: { title: "DriftWallet", portfolio: "Portafolio", approve: "Revisar ({{count}})", connect: "Conectar" },
  approval: {
    title: "Revisar solicitud",
    approve: "Aprobar",
    reject: "Rechazar",
    alwaysAsk: "Preguntar siempre",
    autoReject: "Rechazar este sitio",
  },
  settings: { title: "Ajustes", autoLock: "Bloqueo automático", testnet: "Modo testnet", spamHide: "Ocultar spam" },
  common: { cancel: "Cancelar", confirm: "Confirmar", back: "Atrás", close: "Cerrar" },
};

export const SUPPORTED_LOCALES = ["en", "fr", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function createExtensionI18n(lng: SupportedLocale = "en"): i18n {
  const inst = createInstance();
  void inst.init({
    lng,
    fallbackLng: "en",
    initAsync: false,
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      es: { translation: es },
    },
  });
  return inst;
}

/** All translation keys, for exhaustiveness tests. */
export function allKeys(): string[] {
  const walk = (obj: Record<string, unknown>, prefix: string): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === "object" && v !== null ? walk(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  return walk(en as unknown as Record<string, unknown>, "");
}
