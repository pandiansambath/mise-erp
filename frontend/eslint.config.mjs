import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Fetch-on-mount with setState is the canonical useEffect use here. This
      // new advisory rule false-positives on it; we'll migrate data fetching to
      // TanStack Query (planned stack) and re-enable then.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
