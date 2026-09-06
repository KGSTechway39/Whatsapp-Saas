import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit / integration tests.
 *
 * Scope is deliberate: these cover the PURE logic where a silent wrong answer
 * costs money or breaks Meta compliance — paise arithmetic, the 24-hour window
 * decision, and appointment time conversion. Anything needing a live Supabase or
 * Meta connection belongs in the Playwright e2e suite, not here, so `npm test`
 * stays fast and runs with no credentials.
 *
 * The `@/` alias is set explicitly rather than via vite-tsconfig-paths: that
 * plugin is ESM-only and this package is CommonJS, so it cannot load a .ts
 * config. One line here beats a dependency and a config-format change.
 *
 * e2e/ is excluded because those are Playwright specs — running them under
 * Vitest would load a different `test`/`expect` and fail confusingly.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.d.ts"],
    },
  },
});
