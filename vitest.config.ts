import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/bracket.ts"],
      thresholds: {
        // CLAUDE.md mandates 100% on lib/bracket.ts — a bug here corrupts
        // every user's bracket.
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
