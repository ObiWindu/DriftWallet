# DriftWallet — Self-Custody Wallet Spec (Most Secure Approach)
Version: 1.0.0 | Date: 2026-10-27 | Status: BUILD-READY FOR AI AGENT
Targets: Android, iOS, Chrome (MV3), Firefox (MV3 + browser polyfill)
Chains: EVM x5 (Ethereum, BNB Chain, Polygon PoS, Arbitrum One, Base) + Solana + Cardano + Bitcoin
Security posture: NON-CUSTODIAL, RUST SIGNER DAY-1, ZERO TRUST UI, AUDIT-GATED RELEASE

---

## 1. Objective & Non-Goals

### 1.1 Objective
Build a self-custody wallet where:
1. Seed/private keys are generated, stored, and used ONLY inside an audited Rust `signer` core.
2. TypeScript UI/mobile/extension NEVER sees plaintext seed. It only passes `UnsignedIntent` -> receives `SignedBytes`.
3. Same Rust core compiles to: Android (UniFFI/JNI + Kotlin), iOS (UniFFI/XCFramework + Swift), Web/WASM (extension popup + offscreen + mobile fallback).
4. Supports: native coin send/receive, ERC-20/SPL/CIP-68/BRC-20-ish token display + transfer, EIP-712 clear-sign, WalletConnect v2, EIP-1193 injection, CIP-30 connector, BTC PSBT, address book, phishing + simulation policy engine.

### 1.2 Non-Goals V1
- No custodial backend, no key escrow, no email recovery holding keys.
- No in-house swap aggregator logic (integrate 0x / Jupiter / etc via gateway, unsigned-then-sign flow only).
- No staking/vaults/L2 bridging custom contracts beyond standard transfer + token transfer + dApp passthrough signing.
- No Ordinals inscription minting beyond balance + send. Display only.
- No social recovery / MPC / AA smart accounts V1 (design interfaces to allow later).

### 1.3 Top-5 EVM Canonical List (locked)
```ts
const EVM_CHAINS = [
  { id: 1,     name: "ethereum",  rpcAlias: "eth-mainnet" },
  { id: 56,    name: "bnb",       rpcAlias: "bsc-mainnet" },
  { id: 137,   name: "polygon",   rpcAlias: "polygon-mainnet" },
  { id: 42161, name: "arbitrum",  rpcAlias: "arbitrum-mainnet" },
  { id: 8453,  name: "base",      rpcAlias: "base-mainnet" },
] as const;
```
All EVM handled by single `packages/chains-evm` via viem chain config. Adding chain = config only, no new code.

Testnets: Sepolia (11155111), BSC testnet (97), Polygon Amoy (80002), Arbitrum Sepolia (421614), Base Sepolia (84532), Solana devnet, BTC signet, Cardano preprod.

---

## 2. Locked Technology Stack (do not substitute without updating spec)

| Layer | Locked choice + version pin | Rationale (security) |
|---|---|---|
| Monorepo | `pnpm@9.x` workspaces + `turbo@2.x` + `changesets` | Strict lockfile, isolated installs |
| Language UI | `typescript@5.6 strict` + `react@18` + `react-native@0.76` (bare workflow, NOT Expo Go) | Max code share mobile/web, mature audited libs |
| Language core | `rust@1.80+ edition 2021`, `cargo-deny`, `clippy -D warnings` | Memory safety, zeroize, single audit surface |
| Mobile framework | React Native bare + `react-native-mmkv@3` + `react-native-keychain@9` + `expo-local-authentication` | Encrypted storage + Keychain/Keystore |
| Extension | `react@18` + `vite@5` + MV3 service_worker + offscreen doc, `webextension-polyfill` for Firefox | CSP control, isolated signer context |
| State/data | `zustand@5` + `@tanstack/react-query@5` + `zod@3` for all bridge/RPC validation | Runtime validation of untrusted input |
| EVM | `viem@2.x` + `abitype`, `ethers@6` compat shim ONLY for EIP-712/ENS | viem is tree-shakable, modern, audited usage |
| Solana | `@solana/kit@2` (aka web3.js v2) + `@solana-program/token-2022` | v1 deprecated path |
| Bitcoin | `bitcoinjs-lib@7` (TS orchestration) + Rust `bdk_wallet@1` + `rust-bitcoin@0.32` (source of truth for signing) | BDK is standard, PSBT native |
| Cardano | `cardano-serialization-lib@13` (Rust/WASM, Emurgo) + `@meshsdk/core@1` for tx-build orchestration, Rust `cardano-serialization-lib` for signing | Single Rust lib used both sides |
| HD/crypto TS (orchestration only) | `@scure/bip39@1`, `@scure/bip32@1`, `@noble/curves@1`, `@noble/hashes@1`, `@noble/ciphers@1` | Trail of Bits audited, no legacy `bip39/hdkey` |
| Rust crypto | `bip39@2`, `slip10@0`, `k256@0.13`, `ed25519-dalek@2`, `bip32@0.5`, `zeroize@1.8`, `argon2@0.5`, `chacha20poly1305@0.10`, `aes-gcm@0.10`, `getrandom@0.2` | Audited primitives + zeroize |
| EVM Rust | `alloy-primitives@0.8`, `alloy-consensus@0.8` | Correct RLP/EIP-155 signing |
| Storage mobile | MMKV encrypted + Keychain (iOS) / Keystore (Android) | Never AsyncStorage |
| Backend gateway | `fastify@5` + `redis@7` cache + Postgres (index cache only) | No keys ever touch gateway |
| Tests | `vitest@2`, `playwright@1.47`, `maestro` + `detox` (mobile e2e), `cargo test` + `proptest` | Vectors + fuzz |
| Lint/security CI | `eslint`, `tsc --noEmit`, `clippy`, `cargo-audit`, `cargo-deny`, `semgrep`, `socket` / `osv-scanner`, `gitleaks` | Supply-chain gate |

Node >= 20 LTS. Rust stable pinned via `rust-toolchain.toml`.

---

## 3. Monorepo Layout (agent MUST create exactly this)

```
DriftWallet/
  package.json
  pnpm-workspace.yaml
  turbo.json
  rust-toolchain.toml
  SPEC.md (this file)
  apps/
    mobile/                 # RN bare: android/ ios/ src/
    extension/              # single src, dual manifest
      src/popup/ background/ offscreen/ content-script/ injected/
      manifest.chrome.json
      manifest.firefox.json
      vite.config.ts
  packages/
    core/                   # chain-agnostic types, intents, fees, formatting
    signer/                 # Rust crate + TS bindings (THE TRUSTED BASE)
      rust/Cargo.toml
      rust/src/{lib.rs,mnemonic.rs,derive.rs,evm.rs,solana.rs,bitcoin.rs,cardano.rs,vault.rs,zeroize_ext.rs}
      ts/ {index.ts, wasm.ts, uniffi.ts}
    keystore/               # TS orchestration, calls signer, handles lock/unlock UX
    chains-evm/
    chains-solana/
    chains-bitcoin/
    chains-cardano/
    policy-engine/          # phishing, allowlist, simulation checks
    ui/                     # design system, no key logic
    gateway-client/         # typed client for services/gateway
  services/
    gateway/                # RPC proxy + indexer + price, no keys
  tooling/
    eslint-config/ tsconfig/
  tests/
    vectors/                # BIP39/BIP32/EIP712/PSBT fixtures
    e2e/
```

Agent rule: `packages/signer/rust` is the ONLY place allowed to import `bip39`, `k256`, `ed25519-dalek`, handle raw entropy. `grep -r "mnemonic\|seed.*phrase" apps packages --include="*.ts" --include="*.tsx"` must return zero hits outside `keystore` orchestration types (which hold only `opaqueHandleId`, never plaintext).

---

## 4. Signer Core Spec (Rust — most secure path)

### 4.1 Public API (UniFFI + WASM must expose identical functions)

```rust
// rust/src/lib.rs
pub fn generate_mnemonic(strength_bits: u16) -> Result<MnemonicOutput, SignerError>;
// strength_bits in {128, 256} only, CSPRNG via getrandom

pub fn validate_mnemonic(phrase: &str) -> bool;
pub fn entropy_to_vault(phrase: &str, password: &str, argon2_params: Argon2Params) -> Result<EncryptedVault, SignerError>;
pub fn unlock_vault(vault: &EncryptedVault, password_or_kek: &[u8]) -> Result<SessionHandle, SignerError>;
pub fn lock(handle: SessionHandle) -> Result<(), SignerError>; // zeroizes

pub fn derive_pubkey(handle: SessionHandle, path: &str, curve: Curve) -> Result<PubkeyOutput, SignerError>;
// path MUST match allowlist regex ^m\/(\d+'?\/)+\d+'?$ and coin-type allowlist below

pub fn sign_evm(handle: SessionHandle, req: EvmSignRequest) -> Result<EvmSigned, SignerError>;
pub fn sign_solana(handle: SessionHandle, req: SolanaSignRequest) -> Result<SolanaSigned, SignerError>;
pub fn sign_bitcoin(handle: SessionHandle, req: BtcSignRequest) -> Result<BtcSigned, SignerError>;
pub fn sign_cardano(handle: SessionHandle, req: AdaSignRequest) -> Result<AdaSigned, SignerError>;
```

Types:
```rust
enum Curve { Secp256k1, Ed25519 }
struct EncryptedVault { version: u8, nonce: [u8;24], salt: [u8;32], ciphertext: Vec<u8>, argon2: Argon2Params }
struct EvmSignRequest { chain_id: u64, unsigned_rlp: Vec<u8>, typed_data_hash: Option<[u8;32]> } // exactly one set
struct SolanaSignRequest { message_bytes: Vec<u8> } // raw tx message, NOT base58 envelope
struct BtcSignRequest { psbt_base64: String } // signer validates inputs belong to wallet, signs only own inputs
struct AdaSignRequest { tx_body_cbor_hex: String, witnesses_needed: Vec<String> } // bech32 key hashes
```

Rules:
1. `chain_id` MUST be in allowlist `[1,56,137,42161,8453 + testnets when BUILD_ENV=test]`. Reject others.
2. BTC: refuse to sign PSBT with unknown change output, fee > 5% or > 0.01 BTC absolute without `allow_high_fee=true` + policy-engine flag.
3. ADA: verify `tx_body` parses via `cardano-serialization-lib`, witnesses only for derived keys.
4. EVM: verify `unsigned_rlp` parses via `alloy-consensus`, `chain_id` matches RLP, reject `chainId=0` legacy replay.
5. All secret buffers use `Zeroizing<Vec<u8>>` + `zeroize_on_drop`. No `println!/dbg!` of secrets. `#[deny(clippy::unwrap_used)]` in signer (use `Result`).
6. Session auto-expire: handle invalid after 5 min inactivity or explicit `lock()`. WASM `handle` stored in offscreen/service-worker memory only, never `localStorage`.

### 4.2 HD Paths (enforced in Rust, not UI)
```
EVM:     m/44'/60'/0'/0/{0..n}
SOL:     m/44'/501'/{account}'/0'  (backwards-compat m/44'/501'/0'/0' for imported Phantom wallets)
BTC:     m/84'/0'/0'/0/{0..n} (native segwit) + m/86'/0'/0'/0/{0..n} (taproot, V1 receive-only if time)
ADA:     m/1852'/1815'/0'/0/{0..n} (external) + /1/ (change)
```
Derivation via `slip10` + `bip32`. Ed25519 uses SLIP-10 ed25519 (Solana/ADA compatible), secp256k1 uses BIP32.

### 4.3 Vault Crypto
- KDF: `Argon2id, m=64MB, t=3, p=4, salt 32B random`. Params stored in vault header.
- AEAD: `XChaCha20-Poly1305, nonce 24B random`. Plaintext = `seed(64B) || checksum`. Version byte `0x01`.
- Password policy: min 8 chars, zxcvbn score >=3 for new wallets (enforced in UI, not signer).
- Biometric path: random 32B DEK generated in Rust, DEK encrypted by vault password once, then DEK wrapped by Keychain/Keystore (iOS/Android) or WebAuthn PRF (extension opt-in). Biometric unlock unwraps DEK -> unlocks vault WITHOUT password in memory longer than call.

Build targets:
- `cargo build` -> `libdrift_signer.a` via `uniffi-bindgen` -> `android/jniLibs/*`, `ios/DriftSigner.xcframework`
- `wasm-pack build --target bundler` -> `packages/signer/ts/wasm/*` for extension + web fallback
- Mobile MUST use native UniFFI, not WASM. Extension MUST use WASM inside offscreen document only.

---

## 5. Keystore & Storage Spec (TS orchestration, no plaintext)

`packages/keystore` exposes:
```ts
type VaultRef = { vaultId: string; version: 1; storedAt: number };
async function createWallet(password: string, strength: 128|256): Promise<{vaultRef, addresses}>;
async function importWallet(phrase: string, password: string): Promise<{vaultRef}>;
async function unlock(vaultRef, password|biometricAssertion): Promise<{sessionId}>;
async function lock(sessionId): Promise<void>;
function getSessionStatus(sessionId): "locked"|"unlocked";
```

Storage matrix (agent must implement):
| Platform | Encrypted vault blob | DEK/KEK | Session handle |
|---|---|---|---|
| iOS | MMKV encrypted (`cryptKey` from Keychain) key `drift.vault.v1` | Keychain `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, `biometryAny`, `kSecAttrSynchronizable=false` | In-memory JSI only |
| Android | MMKV encrypted, key from Keystore | Keystore `AES256_GCM`, `setUserAuthenticationRequired(true)`, StrongBox if `hasStrongBox()` else TEE | In-memory JSI only |
| Chrome ext | `chrome.storage.local` (ciphertext only) | password-derived (Argon2 via Rust WASM) per unlock; opt WebAuthn PRF wrap | `chrome.storage.session` only, cleared on lock/suspend |
| Firefox ext | `browser.storage.local` same | same | `browser.storage.session` (fallback memory if unavailable) |

Requirements:
- Auto-lock: 5 min default (user 1-30 min), on `AppState.background`, `screen lock`, `suspend`, explicit.
- Screenshot protection: Android `FLAG_SECURE` on wallet/mnemonic screens, iOS hide in app switcher (`ignoreSnapshotOnNextApplicationLaunch` pattern), extension: no copy to clipboard without explicit click + clear after 30s.
- Never backup vault blob to iCloud/Google Drive unless user opts encrypted backup (Android `allowBackup=false`, iOS `kSecAttrSynchronizable=false` default).
- Mnemonic display: one-time, `HDCP/secure` screen, require password+biometric, test confirmation (quiz 3 words), then forbid re-display without password.

---

## 6. Chains Packages Spec

Common interface every chain package implements:
```ts
interface ChainAdapter {
  chainId: string; // "eip155:1" | "solana:mainnet" | "bip122:000000000019d6689c085ae165831e93" | "cardano:mainnet"
  getAddresses(sessionId: string, accountIndex: number): Promise<string[]>;
  getBalance(address: string): Promise<Balance>;
  getHistory(address: string, cursor?: string): Promise<Page<Tx>>;
  buildTransfer(input: TransferInput): Promise<UnsignedIntent>;
  buildTokenTransfer(input: TokenTransferInput): Promise<UnsignedIntent>;
  estimateFee(intent: UnsignedIntent): Promise<FeeQuote>;
  broadcast(signedBytes: Hex | Base64): Promise<TxHash>;
}
type UnsignedIntent = { chainId: string; signerRequest: EvmReq|SolReq|BtcReq|AdaReq; humanReadable: {to, amount, fee, fiat, warnings: string[]} };
```

### 6.1 chains-evm (viem)
- Build with `viem`: `createPublicClient({chain, transport: http(gatewayUrl)})`. Nonce `getTransactionCount`, gas `estimateFeesPerGas + estimateGas`, EIP-1559 default, legacy fallback for BSC.
- ERC-20 via `getContract({abi: erc20Abi})`, `encodeFunctionData("transfer",...)`.
- EIP-712: `hashTypedData` displayed decoded (domain, types, message) via policy-engine; signer receives 32B hash only.
- Broadcast via gateway, confirm with `waitForTransactionReceipt` polling.
- Token list: local allowlist + CoinGecko/TrustWallet tokenlists, user custom token by contract + decimals verification (`decimals()` call).

### 6.2 chains-solana (@solana/kit v2)
- RPC via gateway `/solana`. `getBalance`, `getTokenAccountsByOwner` (SPL), `getSignaturesForAddress`.
- Transfer: SystemProgram.transfer, SPL `transferChecked`. Recent blockhash fetch, `setComputeUnitPrice` for priority fee quote (low/med/high).
- Simulation: `simulateTransaction` pre-sign, show program logs + balance diff in approval screen.

### 6.3 chains-bitcoin (bdk orchestration + Rust sign)
- Address: bech32 `bc1q...` (P2WPKH) default, taproot `bc1p...` opt-in.
- UTXO via gateway Esplora `/btc/address/:addr/utxo`. Coin selection in TS (branch-and-bound, avoid dust), build PSBT via `bitcoinjs-lib`, pass `psbt_base64` to Rust signer. Rust signs only inputs whose `bip32_derivation` matches wallet fingerprint.
- Fee: mempool.space fee tiers (hour/half-hour/fastest), RBF enabled by default (`sequence=0xfffffffd`), change check (must be own address).
- Broadcast via gateway.

### 6.4 chains-cardano (Mesh + CSL)
- Address: bech32 `addr1...` enterprise/base, derivation `1852'/1815'/0'`.
- UTXO via Blockfrost/Koios through gateway. Build with Mesh `Transaction` builder, min-ADA + collateral handling. Pass `tx_body_cbor_hex` to Rust signer (which uses `cardano-serialization-lib` to attach `Vkeywitnesses`).
- Display datum/assets (CIP-68) decoded, warn on unknown Plutus spend.

All amounts in base units (wei/lamports/sats/lovelace) as `bigint` internally, formatted via `core/format`. No `number` for money, no `parseFloat`.

---

## 7. Policy Engine (must block signing if FAIL)

`packages/policy-engine`:
```ts
async function evaluate(intent: UnsignedIntent, origin: string): Promise<{verdict:"allow"|"warn"|"block", reasons: Finding[]}>;
```
Checks:
1. Phishing: local blocklist (Ethereum Phishing Detect + PhishFort + MetaMask eth-phishing-detect) cached via gateway, Levenshtein homograph detect on domain.
2. Allowance: EVM `approve` infinite (`type(uint256).max`) -> `warn` + suggest exact amount.
3. Poison: first/last-4-chars similar address in history but never interacted -> `warn`.
4. Simulation: EVM `eth_call` / Solana `simulate` balance diff vs claimed -> mismatch = `block`.
5. Fee sanity: fee > 5% value or > $50 equiv -> `warn`, require second confirm.
6. Origin: unknown dApp requesting `eth_sign`/`personal_sign` opaque bytes -> `block` (only `personal_sign` with UTF-8 preview + `typedData` allowed).

Approval screen MUST show: origin domain + favicon + chain badge, sender, recipient (ens/solana name resolved + truncated), amount + fiat, fee + fiat, decoded call (e.g. `transfer(0x1234...5678, 100 USDC)`), simulation diff, warnings. [Approve] requires biometric/password if amount > user threshold (default $100).

---

## 8. Apps Spec

### 8.1 Mobile (apps/mobile)
Screens: Onboarding (Create/Import/Ledger) -> Password setup -> Biometric opt-in -> Seed backup quiz -> Home (portfolio + chains tabs) -> Receive (QR + copy) -> Send (address/ENS/SOL name validation + fee picker) -> Activity -> Settings (auto-lock, network, token mgmt, export seed, wipe).
- Navigation: `react-navigation@7` native stack + bottom tabs.
- QR: `react-native-qrcode-svg` + `expo-barcode-scanner` (camera permission justification string required).
- Push: FCM/APNs via gateway subscriptions `{pushToken, sha256(address)}` — never plaintext address linked to device in logs.
- Deep link: `drift://wc?uri=` for WalletConnect.

Hardening: `FLAG_SECURE`, jailbreak detect (`jail-monkey`), cert pinning (`react-native-ssl-pinning` to gateway domain), no screenshots on seed screens.

### 8.2 Extension (apps/extension)
Structure:
- `background/service-worker`: session manager, permission store, gateway client, queue signing requests. No keys, holds only `sessionId` referencing offscreen.
- `offscreen/offscreen.html+js`: loads `signer WASM`, holds Rust session handle, ONLY place calling `sign_*`. Communicates via `chrome.runtime.sendMessage` with `zod` validation + origin check.
- `content-script`: injects `injected.js` (EIP-1193 `window.ethereum`, `window.solana`, `window.cardano`), relays via `window.postMessage` with `channel: "drift-v1"` + origin verification.
- `popup`: React approval + portfolio mini. Full-page `app.html` for onboarding/home (service worker cannot hold DOM).
- Manifest permissions minimal: `storage`, `alarms`, `offscreen`, `activeTab` only. NO `<all_urls>`, use `content_scripts matches` + user-granted origin. CSP: `script-src 'self'; object-src 'none'; connect-src https://gateway.drift.example`.
- Firefox: `manifest.firefox.json` with `browser_specific_settings.gecko.id`, `background.scripts` fallback if SW unsupported, test with `web-ext run`.

DApp flows: `eth_requestAccounts` -> permission prompt -> `eth_sendTransaction` / `eth_signTypedData_v4` -> policy-engine -> offscreen sign -> broadcast. WalletConnect v2 for mobile + extension via `@walletconnect/*`.

---

## 9. Gateway Service (services/gateway, zero keys)

Endpoints (Fastify, Zod validated, rate-limited, API-key + pinned cert):
```
GET  /v1/prices?assets=ETH,SOL,ADA,BTC
GET  /v1/evm/:chainId/balance/:addr
POST /v1/evm/:chainId/broadcast {rawTx}
GET  /v1/sol/balance/:addr  POST /v1/sol/broadcast
GET  /v1/btc/utxo/:addr  POST /v1/btc/broadcast
GET  /v1/ada/utxo/:addr  POST /v1/ada/broadcast
GET  /v1/phishlist  GET /v1/tokens/:chain
POST /v1/push/subscribe {hashedAddr, pushToken}
```
- Proxies to Alchemy/Infura/Helius/Blockfrost/Esplora with fallback + cache (Redis 30s balances, 60s prices).
- Logs: NO addresses in plaintext beyond hashed, NO request bodies with signed tx linked to IP beyond 24h retention.
- Health: `/healthz`, OpenAPI generated, `npm run gateway:dev`.

---

## 10. Security Gates (AI agent MUST enforce, CI MUST fail if violated)

1. `pnpm -w typecheck && eslint && cargo clippy -- -D warnings && cargo test && pnpm test` green.
2. `gitleaks detect --no-git` + `cargo deny check` + `osv-scanner` clean.
3. No `console.log(seed|mnemonic|privateKey)` — semgrep rule `no-secret-log` must pass.
4. `cargo audit` no critical. `pnpm audit --prod` no critical or documented waiver in `SECURITY_WAIVERS.md`.
5. WASM build reproducible: `wasm-pack build` hash recorded in `packages/signer/ts/wasm.SHA256`.
6. Mobile release: `android:allowBackup=false`, `ios:NSFaceIDUsageDescription` set, ProGuard/R8 + Hermes bytecode, no `debuggable=true`.
7. Extension: `npm run ext:review` checks manifest permissions allowlist + CSP + no inline `<script>` + no `eval`.
8. Test vectors: BIP39 English vectors (12/24), BIP32 vectors 1-3, EIP-712 example, Solana sign example, BTC PSBT (BIP174) example, ADA CIP-1852 example — all must pass.

Threat model file: agent must create `THREAT_MODEL.md` (STRIDE per component + mitigations) before Phase 3 code.

---

## 11. Implementation Task Order for AI Agent (execute sequentially, do not skip)

T001 Scaffold monorepo: pnpm-workspace, turbo, tsconfig base strict, eslint, rust-toolchain, .gitignore (never commit .env, keystore fixtures). Acceptance: `pnpm -w build` skeleton passes.
T002 Implement `packages/signer/rust`: mnemonic, vault (Argon2id+XChaCha), derive, sign_evm/sol/btc/ada + zeroize + UniFFI + WASM bindings + `cargo test` vectors. Acceptance: all vectors green, `cargo clippy -D warnings` clean.
T003 TS bindings `packages/signer/ts`: `wasm.ts` loader (offscreen only) + `uniffi.ts` (mobile JSI) with identical `SignerIface`. Acceptance: vitest mock sign round-trip.
T004 `packages/core`: types, chains registry, bigint money, formatting, fees. Acceptance: 100% unit coverage for format/parse.
T005 `packages/keystore`: create/import/unlock/lock + MMKV/Keychain/Keystore adapters (mock for node) + auto-lock timer. Acceptance: lock wipes session, unlock wrong password fails, no plaintext seed in heap snapshot test.
T006 `packages/chains-*` (one PR per chain): adapter + build/fee/broadcast against testnet fork/mocks. Order: evm -> solana -> bitcoin -> cardano. Acceptance: send 0-value + token transfer on local fork/devnet/signet/preprod in CI (or recorded VCR if CI no faucet).
T007 `packages/policy-engine`: blocklists + simulation stubs + evaluate(). Acceptance: infinite approve warns, phishing domain blocks, opaque eth_sign blocks.
T008 `services/gateway`: Fastify proxy + cache + tests. Acceptance: `openapi.json` generated, e2e via mocked upstream.
T009 `apps/mobile`: onboarding -> home -> send/receive + biometric + FLAG_SECURE. Acceptance: Maestro flow create->receive->send on emulator.
T010 `apps/extension`: SW + offscreen WASM signer + content-script injection + approval popup. Acceptance: Playwright connects to test dApp, signs EIP-712 + Solana tx, Firefox loads without errors.
T011 Hardening: pinning, attestation stubs, push without PII, `THREAT_MODEL.md`, `SECURITY.md`, audit prep (SBOM via `cargo cyclonedx` + `pnpm sbom`). Acceptance: all §10 gates pass.
T012 Release: versioning, SBOM, reproducible hashes, store assets, staged rollout checklist.

Each task: run `pnpm typecheck && pnpm test && cargo test` before marking done. Commit per task with `feat(scope): ...` + test evidence.

---

## 12. Commands (canonical)

```bash
pnpm install
pnpm -w build            # turbo build all
pnpm -w typecheck         # tsc --noEmit all
pnpm test                # vitest all
cargo test -p drift-signer --all-features
cargo clippy -p drift-signer -- -D warnings
cargo deny check && cargo audit
pnpm gateway:dev         # services/gateway
pnpm mobile:run:android  # apps/mobile
pnpm mobile:run:ios
pnpm ext:dev:chrome      # vite watch + load unpacked
pnpm ext:dev:firefox     # web-ext run
pnpm ext:build && pnpm ext:review
```

Env (never commit): `GATEWAY_URL`, `ALCHEMY_KEY`, `HELIUS_KEY`, `BLOCKFROST_KEY`, `WC_PROJECT_ID`. Provide `.env.example` only.

---

## 13. Definition of Done V1

- [ ] Fresh install -> create 24-word wallet -> backup quiz -> receive + send on all 8 networks (5 EVM + SOL + ADA + BTC) on testnets, mainnet-ready flag flip only.
- [ ] Lock/unlock + biometric on Android/iOS/Chrome/Firefox, auto-lock verified.
- [ ] dApp connect + sign (EIP-1559, EIP-712, SPL transfer, PSBT, CIP-30) with simulation + phishing warnings shown.
- [ ] §10 gates green + `THREAT_MODEL.md` + SBOM + reproducible WASM hash recorded.
- [ ] No secret in logs/storage snapshots (verified by semgrep + manual heap/storage dump test documented in `SECURITY_TEST_EVIDENCE.md`).

Build it in T001->T012 order. Most secure path is mandatory: if tempted to put keys in TS for speed, STOP and implement in Rust signer instead.
