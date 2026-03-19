import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const enforceBaseModal = require("./eslint-rules/enforce-base-modal.cjs");
const noRawTextClasses = require("./eslint-rules/no-raw-text-classes.cjs");
const noRawSpacingClasses = require("./eslint-rules/no-raw-spacing-classes.cjs");

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
        },
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      "custom/enforce-base-modal": "warn",
      "custom/no-raw-text-classes": "warn",
      "custom/no-raw-spacing-classes": "warn",
    },
  }
);
