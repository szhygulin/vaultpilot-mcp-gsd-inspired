import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 10_000,
    // Hermeticity pin — see test/setup.ts. Pins
    // VAULTPILOT_WC_STORAGE=memory before any module load so the default
    // production "persist" mode does not leak files under ~/ during tests.
    setupFiles: ["./test/setup.ts"],
  },
});
