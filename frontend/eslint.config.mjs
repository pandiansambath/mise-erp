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
    // AGENT SCRATCH SPECS. Design and QA passes write throwaway Playwright
    // files while measuring the live site, and they are not tests — they are
    // notes. `.gitignore` keeps them out of CI; without this, `npm run lint`
    // still fails on them locally, which makes the local gate disagree with
    // the one it exists to predict.
    "e2e/_*.spec.ts",
    "e2e/tmp-*.spec.ts",
    "e2e/qa-*.spec.ts",
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
