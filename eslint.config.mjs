import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Phase 1G-A seam actions receive useActionState's previous state
      // before real session logic exists; keep those params intentional.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Coding-agent worktrees hold a full copy of the repository, including its
    // node_modules. Linting them reports thousands of irrelevant problems.
    ".claude/**",
  ]),
]);

export default eslintConfig;
