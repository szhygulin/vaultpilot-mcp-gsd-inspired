// SINGLE SOURCE OF TRUTH — Phase 14 Jupiter v6 swap legacy-tx fixture.
//
// Owned by Plan 14-01. Imported by BOTH 14-01 (test/canonical-dispatch-solana.test.ts —
// allowlist enumeration) AND 14-02 (test/protocols-jupiter.test.ts +
// test/prepare-jupiter-swap.test.ts + test/signing-fingerprint-solana.test.ts
// Fixture Z). NEVER commit a second copy of this base64 — both plans decode the
// IDENTICAL bytes so the allowlist enumeration (14-01) and the binding/fingerprint
// re-assertion (14-02) prove byte-identity against the same single decode.
//
// SHAPE: a SOL->USDC `wrapAndUnwrapSol:true` LEGACY (NOT v0/VersionedTransaction)
// Jupiter v6 swap transaction — the form Jupiter `/swap` returns when
// `asLegacyTransaction:true` is sent on BOTH `/quote` and `/swap` (the FROZEN
// binding accepts only legacy `Transaction.serializeMessage()` bytes; v0 message
// bytes do NOT match — RESEARCH Q2 resolution / Pitfall 1).
//
// PROVENANCE (pinned, deterministic — re-capture ONLY on a deliberate upstream
// re-pin): built from the canonical Solana fixture-family persona
// (5tzF…uAi9 feePayer) + FIXED_BLOCKHASH "111…1" with the top-level instruction
// vector a real `wrapAndUnwrapSol:true` legacy Jupiter swap carries:
//   ComputeBudget setComputeUnitLimit + setComputeUnitPrice
//   ATA create (wSOL)  + System transfer (fund wrap) + Token syncNative (wrap)
//   ATA create (USDC out)
//   Jupiter v6 route   (ONE outer ix — inner DEX hops are CPI, invisible top-level)
//   Token closeAccount (unwrap residual wSOL)
// The bytes are pinned as a literal so NO live `/swap` call and NO live
// `Connection` is ever made (execute-directive: NO LIVE RPC + NO LIVE HTTP).
//
// OPEN-QUESTION-1 RESOLUTION (recorded in 14-01-SUMMARY): decoding this single
// fixture yields the TOP-LEVEL program set
//   { ComputeBudget, AssociatedToken, System, SPL-Token, Jupiter v6 }
// — ComputeBudget DOES appear top-level, so it is added to the dispatch allowlist.
//
// Fixture Z fingerprint anchor (computed at write-time over serializeMessage()
// bytes via the FROZEN computeSolanaPayloadFingerprint; NO beforeAll-snapshot):
//   0x6d14fb2164f56333cc15386d8ca1943d86458473f14526439baf2cffba459550

/**
 * Pinned SOL->USDC `wrapAndUnwrapSol:true` LEGACY Jupiter v6 swap transaction,
 * base64-encoded as `Transaction.serialize({ requireAllSignatures: false })`
 * returns (the `/swap` response shape). `Transaction.from(Buffer.from(this,
 * "base64"))` deserializes it as the LEGACY web3.js v1 `Transaction` class.
 */
export const JUPITER_SWAP_LEGACY_B64 =
  "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAcKSMAbUFkAVFXZ3LDGvOzctPtbLqvBqagrVzkrqqQPBObexN5EZPC5fF7Dn+SK+CEsx3/tGVLagUl0jVROYkvrAA2EwXGYeJ7mWPxMVaF3vlYXCnmMNbOFc8E6pmUiBhwsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACMlyWPTiSJ8bs9ECkUjg2DC1oTmdr/EIQEjnvY2+n4WQMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAAxvp6877brTo9ZfNqq8l0MbG75MLS9uDkfKYCA0UvXWEEedVb8jHAbu50xW7OaBUH/bGy3qP0jlECsc2iVrwTjwabiFf+q4GE+2h/Y0YYwDXaxDncGus7VZig8AAAAAABBt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgFAAUCQA0DAAUACQNQwwAAAAAAAAQGAAIACAMJAAMCAAIMAgAAAADh9QUAAAAACQECAREEBgABAAYDCQAHBAACAQkQ5RfLl3rjrSoAAAAAAAAAAAkDAgAAAQk=";

/**
 * A v0 / VersionedTransaction (MessageV0) base64 of the SAME swap — used by 14-02's
 * anti-pattern guard test. The FROZEN binding accepts ONLY legacy message bytes;
 * the protocol decoder MUST REFUSE this (never silently produce v0 bytes).
 */
export const JUPITER_SWAP_V0_B64 =
  "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAHCkjAG1BZAFRV2dywxrzs3LT7Wy6rwamoK1c5K6qkDwTmDYTBcZh4nuZY/ExVoXe+VhcKeYw1s4VzwTqmZSIGHCzexN5EZPC5fF7Dn+SK+CEsx3/tGVLagUl0jVROYkvrAAMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAAjJclj04kifG7PRApFI4NgwtaE5na/xCEBI572Nvp+FkGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKnG+nrzvtutOj1l82qryXQxsbvkwtL24OR8pgIDRS9dYQR51VvyMcBu7nTFbs5oFQf9sbLeo/SOUQKxzaJWvBOPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAwAFAkANAwADAAkDUMMAAAAAAAAEBgABAAUGBwAGAgABDAIAAAAA4fUFAAAAAAcBAQERBAYAAgAIBgcACQQAAQIHEOUXy5d6460qAAAAAAAAAAAHAwEAAAEJAA==";

/**
 * The TOP-LEVEL program set the single decode above emits (Open-Q1 resolution).
 * Recorded as base58 literals for cross-check ONLY — production code resolves
 * these via SOT getters + @solana/web3.js / @solana/spl-token constants; the
 * dispatch allowlist NEVER inlines the Jupiter base58 (the SOT getter is the
 * only sanctioned read path). ComputeBudget IS present top-level.
 */
export const JUPITER_SWAP_TOP_LEVEL_PROGRAMS = [
  "ComputeBudget111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
] as const;
