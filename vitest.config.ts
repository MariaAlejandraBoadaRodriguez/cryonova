import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      // Critical scientific and security modules are instrumented and gated.
      include: [
        "src/analytics/**/*.ts",
        "src/providers/opendap/**/*.ts",
        "src/providers/grid.ts",
        "src/lib/codes.ts",
        "src/lib/http.ts",
        "src/catalog/search.ts",
        "src/catalog/regions.ts",
        "src/agent/verify.ts",
        "src/agent/fallback.ts",
        "src/jobs/selection.ts",
        "src/reports/csv.ts",
      ],
      thresholds: { lines: 80, branches: 75 },
    },
  },
});
