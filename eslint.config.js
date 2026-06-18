import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
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
const noUnmanagedEffectResources = require("./eslint-rules/no-unmanaged-effect-resources.cjs");
const noSilentCatch = require("./eslint-rules/no-silent-catch.cjs");
const noDirectWhiteColors = require("./eslint-rules/no-direct-white-colors.cjs");
const roleButtonRequiresKeydown = require("./eslint-rules/role-button-requires-keydown.cjs");
const noWholeStoreSubscription = require("./eslint-rules/no-whole-store-subscription.cjs");
const enforceReducedMotionFallback = require("./eslint-rules/enforce-reduced-motion-fallback.cjs");
const preferSharedClipboard = require("./eslint-rules/prefer-shared-clipboard.cjs");
const preferNumeric = require("./eslint-rules/prefer-numeric.cjs");
const noUnprefixedWideMinWidth = require("./eslint-rules/no-unprefixed-wide-min-width.cjs");

export default tseslint.config(
  { ignores: ["dist", "src-tauri"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
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
          "no-unmanaged-effect-resources": noUnmanagedEffectResources,
          "no-silent-catch": noSilentCatch,
          "no-direct-white-colors": noDirectWhiteColors,
          "role-button-requires-keydown": roleButtonRequiresKeydown,
          "no-whole-store-subscription": noWholeStoreSubscription,
          "enforce-reduced-motion-fallback": enforceReducedMotionFallback,
          "prefer-shared-clipboard": preferSharedClipboard,
          "prefer-numeric": preferNumeric,
          "no-unprefixed-wide-min-width": noUnprefixedWideMinWidth,
        },
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
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
          patterns: [
            {
              group: ["**/sub_usage/charts/chartConstants", "@/features/overview/sub_usage/charts/chartConstants"],
              message: "Import chart constants from '@/features/overview/sub_usage/libs/chartConstants' — the charts/ copy is stale.",
            },
            {
              group: ["@/features/*/i18n/*", "**/features/*/i18n/*"],
              message: "Feature-scoped i18n hooks were a half-finished migration; use the global '@/i18n/useTranslation' instead. Add new keys to src/i18n/locales/<lang>.json under the appropriate top-level section.",
            },
          ],
        },
      ],
      "custom/enforce-base-modal": "warn",
      "custom/no-raw-text-classes": "warn",
      "custom/no-raw-spacing-classes": "off",
      "custom/no-raw-shadow-classes": "warn",
      "custom/no-loose-event-payload": "error",
      "custom/no-raw-radius-classes": "warn",
      "custom/no-low-contrast-text-classes": "warn",
      "custom/no-hardcoded-jsx-text": "warn",
      "custom/no-unmanaged-effect-resources": "warn",
      "custom/no-silent-catch": "warn",
      "custom/no-direct-white-colors": "warn",
      "custom/role-button-requires-keydown": "error",
      "custom/no-whole-store-subscription": "warn",
      "custom/enforce-reduced-motion-fallback": "warn",
      "custom/prefer-shared-clipboard": "warn",
      "custom/prefer-numeric": "warn",
      "custom/no-unprefixed-wide-min-width": "warn",
    },
  },
  // Shared design-system primitives may import Tauri IPC for nothing —
  // they're presentational by contract. A "convenience" invoke() in shared/
  // breaks layering for every consumer (testability, SSR-readiness, HMR).
  // This is a strong-pattern enforcement (Architect/strong-patterns "Zero
  // Tauri IPC calls in src/features/shared/").
  // Shared design-system primitives shouldn't reach into Tauri runtime —
  // they're presentational by contract. A "convenience" invoke()/event-listen
  // in shared/ breaks layering for every consumer (testability, SSR-readiness,
  // HMR). This is a strong-pattern enforcement (Architect/strong-patterns
  // "Zero Tauri IPC calls in src/features/shared/").
  //
  // Set to `warn` for now — there are 3 known violations as of 2026-05-01
  // (HealingToast, TitleBar, Sidebar) that genuinely tie shared shell chrome
  // to Tauri runtime; those should be migrated to feature modules opportunistically.
  {
    files: ["src/features/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              importNames: ["invoke"],
              message: "src/features/shared/ is the design-system layer — IPC calls don't belong here. Lift to a feature module that owns the data.",
            },
            {
              name: "@/lib/tauriInvoke",
              message: "src/features/shared/ is the design-system layer — IPC calls don't belong here. Lift to a feature module.",
            },
          ],
          patterns: [
            {
              group: ["@tauri-apps/api/event", "@tauri-apps/api/window", "@tauri-apps/api/app"],
              message: "src/features/shared/ is the design-system layer — Tauri runtime APIs don't belong here. Lift to a feature module.",
            },
          ],
        },
      ],
    },
  },
  // Catalog boundary: src/features/shared/components/** is the domain-agnostic
  // primitive catalog (CATALOG.md). It must not couple to app state, IPC, or a
  // feature — keeping it reusable and keeping the catalog honest. Domain/app-shell
  // code lives in its owning feature or src/features/shared/chrome/. Enforced as
  // an ERROR (the warn-level shared/** rule above is replaced for these files, so
  // the Tauri bans are repeated here). See docs/refactor/catalog-curation.md.
  {
    files: ["src/features/shared/components/**/*.{ts,tsx}"],
    ignores: ["src/features/shared/components/**/*.test.{ts,tsx}", "src/features/shared/components/**/*.stories.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              importNames: ["invoke"],
              message: "shared/components is the design-system catalog — IPC calls don't belong here. Lift to a feature module.",
            },
            {
              name: "@/lib/tauriInvoke",
              message: "shared/components is the design-system catalog — IPC calls don't belong here. Lift to a feature module.",
            },
          ],
          patterns: [
            {
              group: ["@/stores/*", "@/stores/**", "@/api/*", "@/api/**", "@/lib/bindings/*", "@/lib/bindings/**"],
              message: "shared/components is the domain-agnostic catalog — no store/api/binding imports. Pass data via props, or move this file to its owning feature / src/features/shared/chrome/. See docs/refactor/catalog-curation.md.",
            },
            {
              group: ["@/features/*/**", "!@/features/shared/**"],
              message: "shared/components is the catalog — it must not import from a feature. Pass via props, or relocate the component (domain → feature, app-shell → shared/chrome). See docs/refactor/catalog-curation.md.",
            },
            {
              group: ["@tauri-apps/api/event", "@tauri-apps/api/window", "@tauri-apps/api/app"],
              message: "shared/components is the design-system catalog — Tauri runtime APIs don't belong here. Lift to a feature module.",
            },
          ],
        },
      ],
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
