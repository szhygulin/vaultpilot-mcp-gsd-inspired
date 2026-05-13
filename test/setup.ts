// Global vitest setup — hermeticity pin for the WalletConnect persistent
// storage default.
//
// Plan 260513-c8e (issue #25) makes "persist" the production default for
// VAULTPILOT_WC_STORAGE. Test suites that exercise SignClient.init would
// otherwise call `ensureStorageDirWithPerms(~/.vaultpilot-mcp/wc-storage/)`
// at first init and leave a real directory on the host. This module runs
// BEFORE any other module load (wired via `vitest.config.ts::setupFiles`)
// and pins the env var to `"memory"`, so every test starts in the
// `:memory:` arm by default.
//
// Individual tests that NEED to exercise the persist branch override via a
// scoped `beforeEach` that sets `VAULTPILOT_WC_STORAGE=persist` AND mocks
// `ensureStorageDirWithPerms` (or uses a tmpdir + restores in `afterEach`).
// See `test/wallet-walletconnect-client.test.ts` for the canonical
// override-and-restore pattern.
//
// Side-effect-only module — no exports.

process.env.VAULTPILOT_WC_STORAGE = "memory";
