import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "lib/bracket.ts",
        "lib/annex-c.ts",
        "lib/lock-check.ts",
        "lib/apifootball.ts",
        "lib/scoring.ts",
      ],
      thresholds: {
        // CLAUDE.md mandates 100% on lib/bracket.ts — a bug here corrupts
        // every user's bracket. lib/annex-c.ts drives FIFA-compliant R32
        // matchups; lib/lock-check.ts gates every write API, and
        // lib/apifootball.ts is the only thing standing between the
        // upstream feed and our scoring engine — all held to the same bar.
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
