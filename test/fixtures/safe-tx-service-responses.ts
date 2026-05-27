// Phase 36 Plan 36-01 — Safe Tx Service response fixtures.
//
// Typed JSON fixtures consumed by `test/clients-safe-tx-service.test.ts` AND
// by Wave 2 integration tests (`test/integration/safe-positions.test.ts`).
// Shapes match RESEARCH § lines 639-700 (verbatim from
// `safe-core-sdk@main/api-kit/src/types/safeTransactionServiceTypes.ts`).
//
// Pitfall 3 anchor: numeric fields (`nonce`, `value`, `safeTxGas`, `baseGas`,
// `gasPrice`) are JSON STRINGS over the wire — Safe Tx Service preserves
// uint256 precision via string encoding. The client preserves the strings
// verbatim; consumers do `BigInt(...)` at use site.
//
// Pitfall 6 anchor: `confirmations` field is OPTIONAL — `undefined` for
// un-signed pending txs (NOT empty array). `MULTISIG_TX_NO_CONFIRMATIONS_FIXTURE`
// captures this shape.

// Canonical fixture addresses (checksummed). Re-used across tests so that
// integration / unit fixtures share the same Safe identity.
export const SAFE_ADDRESS_1OF1 = "0x1111111111111111111111111111111111111111";
export const SAFE_ADDRESS_2OF3 = "0x2222222222222222222222222222222222222222";
export const OWNER_A = "0xAaAaAaaAaAaAaAaAaAaaAAAAAAaAaAAAAaaaAaAa";
export const OWNER_B = "0xBbBbBBbbbBbBBBbBBbbBBBBbbbBbBBbBBbbBBBBb";
export const OWNER_C = "0xCcCccccCCcccCCCcccccCcccccccCCCCCcccCCcC";

// SafeInfoResponse shape (RESEARCH § lines 639-668). Numeric fields as
// STRINGS (Pitfall 3); `singleton` field carries the v1.4.1-L1 mainnet
// address by default.
export const SAFE_INFO_OK_FIXTURE = {
  address: SAFE_ADDRESS_1OF1,
  nonce: "5",
  threshold: 1,
  owners: [OWNER_A],
  singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a", // v1.4.1-L1
  modules: [],
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  guard: "0x0000000000000000000000000000000000000000",
  version: "1.4.1",
};

export const SAFE_INFO_2_OF_3_FIXTURE = {
  address: SAFE_ADDRESS_2OF3,
  nonce: "12",
  threshold: 2,
  owners: [OWNER_A, OWNER_B, OWNER_C],
  singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762", // v1.4.1-L2
  modules: [],
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  guard: "0x0000000000000000000000000000000000000000",
  version: "1.4.1",
};

// Owner-safes lookup. Empty result is represented as `{ safes: [] }`; the
// 404 case is exercised at the client layer (separate arm).
export const OWNER_SAFES_OK_FIXTURE = {
  safes: [SAFE_ADDRESS_1OF1, SAFE_ADDRESS_2OF3],
};

export const OWNER_SAFES_EMPTY_FIXTURE = {
  safes: [],
};

// PendingListResponse shape — `count` is the total across the result set,
// `results` is the paginated slice. `confirmations` is included on the
// signed-tx fixture (one signature collected); absent on the no-confirmations
// variant.
export const MULTISIG_TX_OK_FIXTURE = {
  safe: SAFE_ADDRESS_2OF3,
  to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  value: "0",
  data: "0xa9059cbb000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000000000000000000000000000000000000000000000000000000000003e8",
  operation: 0,
  gasToken: "0x0000000000000000000000000000000000000000",
  safeTxGas: "0",
  baseGas: "0",
  gasPrice: "0",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nonce: "12",
  safeTxHash:
    "0xabc1230000000000000000000000000000000000000000000000000000000000",
  confirmationsRequired: 2,
  confirmations: [
    {
      owner: OWNER_A,
      signature:
        "0x" + "11".repeat(65),
      signatureType: "EOA" as const,
    },
  ],
  signatures: null,
  isExecuted: false,
};

export const MULTISIG_TX_DELEGATECALL_FIXTURE = {
  ...MULTISIG_TX_OK_FIXTURE,
  operation: 1, // delegatecall — Phase 38 hard-trigger consumer cares about this
  safeTxHash:
    "0xdef4560000000000000000000000000000000000000000000000000000000000",
};

// Pitfall 6 anchor — confirmations field intentionally OMITTED (not empty
// array). Captures the un-signed-pending-tx wire shape.
export const MULTISIG_TX_NO_CONFIRMATIONS_FIXTURE = {
  safe: SAFE_ADDRESS_2OF3,
  to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  value: "0",
  data: "0x",
  operation: 0,
  gasToken: "0x0000000000000000000000000000000000000000",
  safeTxGas: "0",
  baseGas: "0",
  gasPrice: "0",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nonce: "13",
  safeTxHash:
    "0xfeed00000000000000000000000000000000000000000000000000000000beef",
  confirmationsRequired: 2,
  // confirmations: OMITTED — Pitfall 6 anchor (un-signed pending tx)
  signatures: null,
  isExecuted: false,
};

export const PENDING_LIST_OK_FIXTURE = {
  count: 1,
  results: [MULTISIG_TX_OK_FIXTURE],
};

export const PENDING_LIST_EMPTY_FIXTURE = {
  count: 0,
  results: [],
};
