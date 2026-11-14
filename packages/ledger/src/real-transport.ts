// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Real Ledger device adapters over @ledgerhq/hw-transport. WebUSB on
// desktop/extension (`createWebUsbTransport`); on React Native, pass the app's
// BLE/HID transport module into `createLedgerTransport` (duck-typed below, so
// no native dep is forced on consumers that never use hardware wallets).
// The @ledgerhq app packages are dynamic-imported only when a sign runs.
// All I/O validated with zod; no secrets are logged (see describeSignRequestSafe).

import { z } from "zod";
import {
  ConnectResult,
  DeviceDescriptor,
  DeviceId,
  SignRequest,
  SignResponse,
  TransportKind,
  type LedgerTransportFns,
} from "./transport.js";

/** Minimal structural type satisfied by TransportWebUSB / RN BLE transports. */
export interface TransportModuleLike {
  isSupported?: () => Promise<boolean>;
  list: () => Promise<unknown[]>;
  create: () => Promise<TransportLike>;
}

export interface TransportLike {
  deviceModel?: { productName?: string | null } | null;
  close: () => Promise<void>;
}

interface Session {
  transport: TransportLike;
  deviceId: string;
}

function descriptorFrom(device: unknown, index: number, kind: z.infer<typeof TransportKind>): DeviceDescriptor {
  const d = (device ?? {}) as { vendorId?: number; productId?: number; productName?: string };
  const deviceId =
    typeof d.vendorId === "number" && typeof d.productId === "number"
      ? `${kind}:${d.vendorId.toString(16)}:${d.productId.toString(16)}:${index}`
      : `${kind}:${index}`;
  return DeviceDescriptor.parse({
    deviceId,
    label: d.productName ?? "Ledger device",
    transport: kind,
  });
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error("odd-length hex payload");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function padHex32(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length > 64) throw new Error("signature component too long");
  return h.padStart(64, "0");
}

async function signWithDevice(transport: TransportLike, req: z.infer<typeof SignRequest>): Promise<string> {
  switch (req.chain) {
    case "evm": {
      // payloadHex = serialized unsigned EIP-1559 tx; device clear-signs fields.
      const { default: Eth } = await import("@ledgerhq/hw-app-eth");
      const eth = new Eth(transport as never);
      const rawTx = req.payloadHex.replace(/^0x/i, "");
      const { r, s, v } = await eth.signTransaction(req.path, rawTx);
      const vByte = v.replace(/^0x/i, "").padStart(2, "0");
      return `0x${padHex32(r)}${padHex32(s)}${vByte}`;
    }
    case "solana": {
      const { default: Solana } = await import("@ledgerhq/hw-app-solana");
      const { Buffer } = await import("buffer");
      const sol = new Solana(transport as never);
      const { signature } = await sol.signTransaction(req.path, Buffer.from(hexToBytes(req.payloadHex)));
      return `0x${Buffer.from(signature).toString("hex")}`;
    }
    default:
      throw new Error(
        `ledger adapter: '${req.chain}' on-device app flow not wired here (btc/ada device e2e deferred to speculos/emulator runs)`,
      );
  }
}

/**
 * Adapt a @ledgerhq transport module (WebUSB, BLE, HID) to LedgerTransportFns.
 * Sessions are process-local (Map); nothing is persisted.
 */
export function createLedgerTransport(
  mod: TransportModuleLike,
  kind: z.infer<typeof TransportKind> = "usb",
): LedgerTransportFns {
  TransportKind.parse(kind);
  const sessions = new Map<string, Session>();
  let counter = 0;
  return {
    async listDevices(): Promise<DeviceDescriptor[]> {
      const devices = await mod.list();
      return devices.map((d, i) => descriptorFrom(d, i, kind));
    },
    async connect(deviceId: string): Promise<ConnectResult> {
      const id = DeviceId.parse(deviceId);
      const transport = await mod.create();
      counter += 1;
      const sessionId = `ledger-${counter}`;
      sessions.set(sessionId, { transport, deviceId: id });
      return ConnectResult.parse({ sessionId, deviceId: id });
    },
    async sign(req: SignRequest): Promise<SignResponse> {
      const parsed = SignRequest.parse(req);
      const session = sessions.get(parsed.sessionId);
      if (!session) throw new Error("unknown session");
      const signatureHex = await signWithDevice(session.transport, parsed);
      return SignResponse.parse({ signatureHex, deviceId: session.deviceId });
    },
    async disconnect(sessionId: string): Promise<void> {
      const id = z.string().min(1).max(128).parse(sessionId);
      const session = sessions.get(id);
      if (!session) throw new Error("unknown session");
      sessions.delete(id);
      await session.transport.close();
    },
  };
}

/** WebUSB transport for desktop browsers / the extension. Lazy-loaded. */
export async function createWebUsbTransport(): Promise<LedgerTransportFns> {
  const mod = await import("@ledgerhq/hw-transport-webusb");
  const transportModule = (mod.default ?? mod) as TransportModuleLike;
  return createLedgerTransport(transportModule, "usb");
}
