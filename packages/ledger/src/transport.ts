// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// ---------------------------------------------------------------------------
// Local chain constants (redeclared — no imports from @drift/core per U032
// file-ownership rules). Values mirror packages/core/src/index.ts.
// ---------------------------------------------------------------------------

export const LEDGER_CHAIN_IDS = {
  ethereum: "eip155:1",
  bnb: "eip155:56",
  polygon: "eip155:137",
  arbitrum: "eip155:42161",
  base: "eip155:8453",
  solana: "solana:mainnet",
  bitcoin: "bip122:000000000019d6689c085ae165831e93",
  cardano: "cardano:mainnet",
} as const;

export type LedgerChainKey = keyof typeof LEDGER_CHAIN_IDS;

export const LEDGER_EVM_CHAIN_IDS = [1, 56, 137, 42161, 8453] as const;
export type LedgerEvmChainId = (typeof LEDGER_EVM_CHAIN_IDS)[number];

const LEDGER_EVM_TESTNETS = [11155111, 97, 80002, 421614, 84532] as const;

export const LEDGER_ALLOWED_EVM_CHAINS: ReadonlySet<number> = new Set<number>([
  ...LEDGER_EVM_CHAIN_IDS,
  ...LEDGER_EVM_TESTNETS,
]);

export function ledgerDerivationPath(chain: "evm" | "solana" | "bitcoin" | "cardano", index: number): string {
  const i = z.number().int().nonnegative().parse(index);
  switch (chain) {
    case "evm":
      return `m/44'/60'/0'/0/${i}`;
    case "solana":
      return `m/44'/501'/${i}'/0'`;
    case "bitcoin":
      return `m/84'/0'/0'/0/${i}`;
    case "cardano":
      return `m/1852'/1815'/0'/0/${i}`;
  }
}

// ---------------------------------------------------------------------------
// Minimal local transport types (no @ledgerhq deps per task constraints).
// All I/O validated with zod. No secrets are logged.
// ---------------------------------------------------------------------------

export const TransportKind = z.enum(["hid", "ble", "usb", "mock"]);
export type TransportKind = z.infer<typeof TransportKind>;

export const DeviceId = z.string().min(1).max(128);
export type DeviceId = z.infer<typeof DeviceId>;

export const DeviceDescriptor = z.object({
  deviceId: DeviceId,
  label: z.string().min(1).max(64),
  transport: TransportKind,
  /** App name currently open on the device, e.g. "Ethereum". Unknown when not queried. */
  openApp: z.string().min(1).max(32).optional(),
  /** App version string reported by the device, e.g. "1.9.19". */
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
});
export type DeviceDescriptor = z.infer<typeof DeviceDescriptor>;

export const SessionId = z.string().min(1).max(128);
export type SessionId = z.infer<typeof SessionId>;

export const ConnectResult = z.object({
  sessionId: SessionId,
  deviceId: DeviceId,
});
export type ConnectResult = z.infer<typeof ConnectResult>;

export const HexPayload = z.string().regex(/^0x[0-9a-fA-F]*$/);
export const DerivationPath = z
  .string()
  .min(1)
  .max(128)
  .regex(/^m(\/\d+'?)+$/);

export const SignRequest = z.object({
  sessionId: SessionId,
  path: DerivationPath,
  /** Hex-encoded payload the device should sign (tx hash, message bytes, ...). */
  payloadHex: HexPayload,
  /** Chain-scoped context so the transport can route to the right device app. */
  chain: z.enum(["evm", "solana", "bitcoin", "cardano"]),
});
export type SignRequest = z.infer<typeof SignRequest>;

export const SignResponse = z.object({
  signatureHex: HexPayload,
  deviceId: DeviceId,
});
export type SignResponse = z.infer<typeof SignResponse>;

/** Injected async functions — real HID/BLE adapters or mocks implement these. */
export interface LedgerTransportFns {
  listDevices: () => Promise<DeviceDescriptor[]>;
  connect: (deviceId: string) => Promise<ConnectResult>;
  sign: (req: SignRequest) => Promise<SignResponse>;
  disconnect: (sessionId: string) => Promise<void>;
}

/** Registry wrapping injected fns with zod validation + safe error surfacing. */
export class TransportRegistry {
  private readonly fns: LedgerTransportFns;
  private readonly sessions = new Map<string, string>();

  constructor(fns: LedgerTransportFns) {
    this.fns = fns;
  }

  async listDevices(): Promise<DeviceDescriptor[]> {
    const devices = await this.fns.listDevices();
    return z.array(DeviceDescriptor).parse(devices);
  }

  async connect(deviceId: string): Promise<ConnectResult> {
    const id = DeviceId.parse(deviceId);
    const result = ConnectResult.parse(await this.fns.connect(id));
    this.sessions.set(result.sessionId, result.deviceId);
    return result;
  }

  async sign(req: SignRequest): Promise<SignResponse> {
    const parsed = SignRequest.parse(req);
    if (!this.sessions.has(parsed.sessionId)) {
      throw new Error(`unknown session`);
    }
    return SignResponse.parse(await this.fns.sign(parsed));
  }

  async disconnect(sessionId: string): Promise<void> {
    const id = SessionId.parse(sessionId);
    await this.fns.disconnect(id);
    this.sessions.delete(id);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}

// ---------------------------------------------------------------------------
// In-memory / mock transport for tests and UI development. No network,
// no real devices. Signatures are deterministic fixtures, never real keys.
// ---------------------------------------------------------------------------

const MockDeviceSeed = z.object({
  deviceId: z.string().min(1).max(128).default("mock-ledger-1"),
  label: z.string().min(1).max(64).default("Mock Ledger Nano"),
  transport: TransportKind.default("mock"),
  openApp: z.string().min(1).max(32).optional(),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
});
export type MockDeviceSeed = z.input<typeof MockDeviceSeed>;

export function createMemoryTransport(seeds: MockDeviceSeed[] = [{}]): LedgerTransportFns {
  const parsedSeeds = z.array(MockDeviceSeed).parse(seeds);
  const devices: DeviceDescriptor[] = parsedSeeds.map((s, i) => ({
    deviceId: s.deviceId ?? `mock-ledger-${i + 1}`,
    label: s.label ?? "Mock Ledger Nano",
    transport: s.transport ?? "mock",
    ...(s.openApp === undefined ? {} : { openApp: s.openApp }),
    ...(s.appVersion === undefined ? {} : { appVersion: s.appVersion }),
  }));
  const sessions = new Map<string, string>();
  let counter = 0;

  return {
    async listDevices(): Promise<DeviceDescriptor[]> {
      return z.array(DeviceDescriptor).parse(structuredClone(devices));
    },
    async connect(deviceId: string): Promise<ConnectResult> {
      const id = DeviceId.parse(deviceId);
      const found = devices.find((d) => d.deviceId === id);
      if (!found) throw new Error(`device not found`);
      counter += 1;
      const session: ConnectResult = { sessionId: `sess-${counter}`, deviceId: found.deviceId };
      sessions.set(session.sessionId, session.deviceId);
      return ConnectResult.parse(session);
    },
    async sign(req: SignRequest): Promise<SignResponse> {
      const parsed = SignRequest.parse(req);
      const deviceId = sessions.get(parsed.sessionId);
      if (deviceId === undefined) throw new Error(`unknown session`);
      // Deterministic fixture signature: 64 zero-ish bytes derived from payload length.
      // Never a real signature; labels the transport as mock for tests.
      const len = Math.floor((parsed.payloadHex.length - 2) / 2);
      const tail = len.toString(16).padStart(2, "0");
      const sig = `0x${"ab".repeat(63)}${tail}`;
      return SignResponse.parse({ signatureHex: sig, deviceId });
    },
    async disconnect(sessionId: string): Promise<void> {
      const id = SessionId.parse(sessionId);
      if (!sessions.has(id)) throw new Error(`unknown session`);
      sessions.delete(id);
    },
  };
}

/** Redact helper: never include secrets (paths are ok, payloads truncated). */
export function describeSignRequestSafe(req: SignRequest): string {
  const parsed = SignRequest.parse(req);
  return `sign(chain=${parsed.chain}, path=${parsed.path}, payloadBytes=${(parsed.payloadHex.length - 2) / 2})`;
}
