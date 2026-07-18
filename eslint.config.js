// Flat config (ESLint 9). ESM — this repo is "type": "module".
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  // Never lint build output, deps, generated bundles, or shadcn primitives
  // (the latter are vendored upstream and churn on every shadcn update).
  {
    ignores: [
      "dist/**",
      "build/**",
      "node_modules/**",
      "client/src/components/ui/**",
      "*.config.js",
      "*.config.ts",
      // Untracked local agent tooling (Ruflo/claude-flow helpers, MCP config).
      // Never part of the product codebase; must not be linted or committed.
      ".claude/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Shared rule tuning for all TS/TSX we own.
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      // The codebase deliberately casts session/user objects.
      "@typescript-eslint/no-explicit-any": "off",
      // Real-bug rules stay as errors, but allow _-prefixed intentional unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `declare global { namespace Express { ... } }` is the standard TS
      // idiom for augmenting third-party ambient types (server/tenant.ts).
      // Still flags real `namespace Foo {}` module-organization misuse.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
    },
  },

  // Client: React + browser globals + a11y (a11y is warn until Wave 3).
  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-refresh/only-export-components": "off",
      // a11y baseline fixed in Wave 2 Task 4; enforced at error so it can't regress.
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/label-has-associated-control": "error",
    },
  },

  // Server + shared: Node globals.
  {
    files: ["server/**/*.ts", "shared/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Test files: Node test-runner + Vitest globals; relax noise.
  // Includes tests/**/*.mjs (e.g. tests/load/join-storm.mjs) — standalone
  // Node load-test scripts that also need process/console/fetch globals.
  {
    files: ["**/*.test.ts", "tests/**/*.ts", "tests/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },

  // Must be LAST: turn off rules that conflict with Prettier.
  prettier,
);
