import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const enforceBaseModal = require("./eslint-rules/enforce-base-modal.cjs");
const noRawTextClasses = require("./eslint-rules/no-raw-text-classes.cjs");
const noRawSpacingClasses = require("./eslint-rules/no-raw-spacing-classes.cjs");
const noRawShadowClasses = require("./eslint-rules/no-raw-shadow-classes.cjs");
const noLooseEventPayload = require("./eslint-rules/no-loose-event-payload.cjs");
const noRawRadiusClasses = require("./eslint-rules/no-raw-radius-classes.cjs");
const noLowContrastTextClasses = require("./eslint-rules/no-low-contrast-text-classes.cjs");
const noHardcodedJsxText = require("./eslint-rules/no-hardcoded-jsx-text.cjs");

export default tseslint.config(
  { ignores: ["dist", "src-tauri"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2021,
      globals: globals.browser,
    },
    plugins: {
      "custom": {
        rules: {
          "enforce-base-modal": enforceBaseModal,
          "no-raw-text-classes": noRawTextClasses,
          "no-raw-spacing-classes": noRawSpacingClasses,
          "no-raw-shadow-classes": noRawShadowClasses,
          "no-loose-event-payload": noLooseEventPayload,
          "no-raw-radius-classes": noRawRadiusClasses,
          "no-low-contrast-text-classes": noLowContrastTextClasses,
          "no-hardcoded-jsx-text": noHardcodedJsxText,
        },
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              importNames: ["invoke"],
              message: "Use invokeWithTimeout from '@/lib/tauriInvoke' instead of raw invoke. It adds timeout protection, IPC metrics, idempotency dedup, and typed CommandName safety.",
            },
          ],
        },
      ],
      "custom/enforce-base-modal": "warn",
      "custom/no-raw-text-classes": "warn",
      "custom/no-raw-spacing-classes": "warn",
      "custom/no-raw-shadow-classes": "warn",
      "custom/no-loose-event-payload": "error",
      "custom/no-raw-radius-classes": "warn",
      "custom/no-low-contrast-text-classes": "warn",
      "custom/no-hardcoded-jsx-text": "warn",
    },
  },
  // Allow raw invoke in the wrapper itself, test mocks, and test automation bridge
  {
    files: [
      "src/lib/tauriInvoke.ts",
      "src/test/tauriMock.ts",
      "src/test/automation/bridge.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  }
);
