import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Build output, dependencies, reports, the Python virtualenv and the design
  // prototype are never linted ("npm run lint" also names the source folders).
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "docs/design/prototype/**",
    ".venv/**",
    "analytics/**",
    "next-env.d.ts",
  ]),
]);
