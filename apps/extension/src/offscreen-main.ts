// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Offscreen document entry: relays chrome.runtime messages to
// handleOffscreenMessage with the production WASM signer.
// The session lives in WASM linear memory only — never persisted.
import {
  handleOffscreenMessage,
  type SignerIface,
} from "./offscreen.js";

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(
        fn: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void,
      ): void;
    };
  };
};

/**
 * Shape of the wasm-pack glue at `wasm-pkg/drift_signer.js` (staged into
 * dist/wasm-pkg by the build). Every export takes one JSON-string request
 * and returns a JSON-string response (`{...}` or `{"error":"..."}`);
 * `default` is wasm-bindgen's init and fetches the .wasm next to the glue.
 */
interface WasmGlue {
  default?(input?: unknown): Promise<unknown>;
  unlock_vault(req: string): string;
  lock_session(req: string): string;
  sign_evm(req: string): string;
  sign_solana(req: string): string;
  sign_bitcoin(req: string): string;
  sign_cardano(req: string): string;
}

function call(
  glue: WasmGlue,
  fn: "unlock_vault" | "lock_session" | "sign_evm" | "sign_solana" | "sign_bitcoin" | "sign_cardano",
  req: unknown,
): Record<string, unknown> {
  const parsed = JSON.parse(glue[fn](JSON.stringify(req))) as Record<string, unknown>;
  if (typeof parsed.error === "string") throw new Error(`signer ${fn}: ${parsed.error}`);
  return parsed;
}

function sessionIdOf(session: object): number {
  const id = (session as { sessionId?: unknown }).sessionId;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error("bad session handle");
  }
  return id;
}

async function loadWasmSigner(): Promise<SignerIface> {
  // Variable URL keeps both TS and vite from resolving at build time;
  // wasm-pack output is staged into dist/wasm-pkg by `pnpm ext:build`.
  const wasmUrl: string = "../wasm-pkg/drift_signer.js";
  const mod = (await import(/* @vite-ignore */ wasmUrl)) as WasmGlue & { default?: (input?: unknown) => Promise<unknown> };
  if (typeof mod.default === "function") await mod.default();
  return {
    async unlockVault(payload) {
      const p = call(mod, "unlock_vault", payload);
      return { sessionId: p.sessionId };
    },
    async lockSession(session) {
      call(mod, "lock_session", { sessionId: sessionIdOf(session) });
    },
    async signEth(payload, session) {
      const p = call(mod, "sign_evm", { sessionId: sessionIdOf(session), ...payload });
      return p.rawTxHex as string;
    },
    async signSolana(payload, session) {
      const p = call(mod, "sign_solana", { sessionId: sessionIdOf(session), ...payload });
      return p.signatureBase58 as string;
    },
    async signBtc(payload, session) {
      const p = call(mod, "sign_bitcoin", { sessionId: sessionIdOf(session), ...payload });
      return JSON.stringify(p.signatures ?? []);
    },
    async signCardano(payload, session) {
      const p = call(mod, "sign_cardano", { sessionId: sessionIdOf(session), ...payload });
      return JSON.stringify({ witnesses: p.witnesses ?? [], txBodyHashHex: p.txBodyHashHex ?? null });
    },
  };
}

let signerPromise: Promise<SignerIface> | null = null;

chrome.runtime.onMessage.addListener((raw: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
  if (!signerPromise) signerPromise = loadWasmSigner();
  void (async () => {
    try {
      const signer = await signerPromise;
      sendResponse(await handleOffscreenMessage(raw, signer));
    } catch (e) {
      sendResponse({ requestId: "", ok: false, error: e instanceof Error ? e.message : "signer failed" });
    }
  })();
  return true;
});
