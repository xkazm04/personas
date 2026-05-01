/**
 * RuleTester coverage for the 11 custom ESLint rules in `eslint-rules/`.
 *
 * Each rule gets a few valid + invalid cases. Coverage is illustrative, not
 * exhaustive — the goal is to catch behavior regressions when a rule's regex
 * or AST traversal is edited, not to enumerate every possible input.
 */

import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
import { createRequire } from "node:module";
import tsParser from "@typescript-eslint/parser";

const require = createRequire(import.meta.url);

const enforceBaseModal = require("../../../eslint-rules/enforce-base-modal.cjs");
const noHardcodedJsxText = require("../../../eslint-rules/no-hardcoded-jsx-text.cjs");
const noLooseEventPayload = require("../../../eslint-rules/no-loose-event-payload.cjs");
const noLowContrastTextClasses = require("../../../eslint-rules/no-low-contrast-text-classes.cjs");
const noRawRadiusClasses = require("../../../eslint-rules/no-raw-radius-classes.cjs");
const noRawShadowClasses = require("../../../eslint-rules/no-raw-shadow-classes.cjs");
const noRawSpacingClasses = require("../../../eslint-rules/no-raw-spacing-classes.cjs");
const noRawTextClasses = require("../../../eslint-rules/no-raw-text-classes.cjs");
const noSilentCatch = require("../../../eslint-rules/no-silent-catch.cjs");
const noUnmanagedEffectResources = require("../../../eslint-rules/no-unmanaged-effect-resources.cjs");
const noDirectWhiteColors = require("../../../eslint-rules/no-direct-white-colors.cjs");

// RuleTester needs vitest's `it` / `describe` so its case generation
// integrates with our reporter.
RuleTester.it = it;
RuleTester.describe = describe;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run("custom/enforce-base-modal", enforceBaseModal, {
  valid: [
    {
      code: `import { BaseModal } from "@/lib/ui/BaseModal";
function C() { return <BaseModal isOpen onClose={() => {}}>x</BaseModal>; }`,
    },
    { code: `function C() { return <div>plain</div>; }` },
  ],
  invalid: [
    {
      code: `function C() { return <div role="dialog">raw</div>; }`,
      errors: 1,
    },
    {
      code: `function C() { return <section role="dialog" aria-modal="true">x</section>; }`,
      errors: 1,
    },
  ],
});

ruleTester.run("custom/no-hardcoded-jsx-text", noHardcodedJsxText, {
  valid: [
    {
      code: `function C({ t }: any) { return <button>{t.common.save}</button>; }`,
    },
    {
      // Single chars and pure punctuation are exempt
      code: `function C() { return <span>:</span>; }`,
    },
  ],
  invalid: [
    {
      code: `function C() { return <button>Save changes</button>; }`,
      errors: 1,
    },
    {
      code: `function C() { return <input placeholder="Search items" />; }`,
      errors: 1,
    },
  ],
});

ruleTester.run("custom/no-loose-event-payload", noLooseEventPayload, {
  valid: [
    {
      code: `interface FooPayload { id: string }
interface EventPayloadMap { foo: FooPayload }`,
    },
    {
      // Outside EventPayloadMap, Record<string, unknown> is fine
      code: `interface OtherMap { foo: Record<string, unknown> }`,
    },
  ],
  invalid: [
    {
      code: `interface EventPayloadMap { foo: Record<string, unknown> }`,
      errors: 1,
    },
    {
      code: `interface EventPayloadMap { foo: { [key: string]: unknown } }`,
      errors: 1,
    },
  ],
});

ruleTester.run(
  "custom/no-low-contrast-text-classes",
  noLowContrastTextClasses,
  {
    valid: [
      {
        code: `function C() { return <p className="text-foreground">body</p>; }`,
      },
      {
        // State-modified mutes are OK (intentional disabled/hover styling)
        code: `function C() { return <p className="disabled:text-muted-foreground/50">body</p>; }`,
      },
      {
        // /85 and above are effectively the same as bare text-foreground
        code: `function C() { return <p className="text-foreground/90">body</p>; }`,
      },
    ],
    invalid: [
      {
        code: `function C() { return <p className="text-muted-foreground/60">body</p>; }`,
        errors: 1,
      },
      {
        code: `function C() { return <p className="text-foreground/70">body</p>; }`,
        errors: 1,
      },
    ],
  },
);

ruleTester.run("custom/no-raw-radius-classes", noRawRadiusClasses, {
  valid: [
    {
      code: `function C() { return <div className="rounded-card">x</div>; }`,
    },
    {
      code: `function C() { return <div className="rounded-input">x</div>; }`,
    },
  ],
  invalid: [
    {
      code: `function C() { return <div className="rounded-md">x</div>; }`,
      errors: 1,
    },
    {
      code: `function C() { return <div className="rounded-xl">x</div>; }`,
      errors: 1,
    },
  ],
});

ruleTester.run("custom/no-raw-shadow-classes", noRawShadowClasses, {
  valid: [
    {
      code: `function C() { return <div className="shadow-elevation-2">x</div>; }`,
    },
    { code: `function C() { return <div className="shadow-none">x</div>; }` },
  ],
  invalid: [
    {
      code: `function C() { return <div className="shadow-lg">x</div>; }`,
      errors: 1,
    },
    {
      code: `function C() { return <div className="shadow-2xl">x</div>; }`,
      errors: 1,
    },
  ],
});

ruleTester.run("custom/no-raw-spacing-classes", noRawSpacingClasses, {
  valid: [
    {
      // Semantic spacing tokens (not raw Tailwind scale) are OK
      code: `function C() { return <div className="flex">x</div>; }`,
    },
    {
      // Negative classes / arbitrary values aren't matched
      code: `function C() { return <div className="overflow-hidden">x</div>; }`,
    },
  ],
  invalid: [
    {
      code: `function C() { return <div className="p-4">x</div>; }`,
      errors: 1,
    },
    {
      code: `function C() { return <div className="gap-2 px-3">x</div>; }`,
      errors: 1,
    },
  ],
});

ruleTester.run("custom/no-raw-text-classes", noRawTextClasses, {
  valid: [
    {
      code: `function C() { return <p className="typo-body">x</p>; }`,
    },
    {
      // Mono-context text sizes (font-mono nearby) get a pass
      code: `function C() { return <code className="font-mono text-sm">x</code>; }`,
    },
  ],
  invalid: [
    {
      code: `function C() { return <p className="text-xs">x</p>; }`,
      errors: 1,
    },
    {
      code: `function C() { return <p className="text-2xl">x</p>; }`,
      errors: 1,
    },
  ],
});

ruleTester.run("custom/no-silent-catch", noSilentCatch, {
  valid: [
    {
      // catch with logging — fine
      code: `try { f(); } catch (e) { console.error(e); }`,
    },
    {
      // catch that re-throws — fine
      code: `try { f(); } catch (e) { throw e; }`,
    },
  ],
  invalid: [
    {
      code: `try { f(); } catch {}`,
      errors: 1,
    },
    {
      code: `try { f(); } catch (e) {}`,
      errors: 1,
    },
  ],
});

ruleTester.run(
  "custom/no-unmanaged-effect-resources",
  noUnmanagedEffectResources,
  {
    valid: [
      {
        // setInterval with a return-cleanup
        code: `import { useEffect } from "react";
function C() {
  useEffect(() => {
    const id = setInterval(() => {}, 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}`,
      },
      {
        // No resources allocated — nothing to clean up
        code: `import { useEffect } from "react";
function C() {
  useEffect(() => { console.log("mounted"); }, []);
  return null;
}`,
      },
    ],
    invalid: [
      {
        // setInterval without cleanup
        code: `import { useEffect } from "react";
function C() {
  useEffect(() => {
    setInterval(() => {}, 1000);
  }, []);
  return null;
}`,
        errors: 1,
      },
      {
        // addEventListener without cleanup
        code: `import { useEffect } from "react";
function C() {
  useEffect(() => {
    window.addEventListener("resize", () => {});
  }, []);
  return null;
}`,
        errors: 1,
      },
    ],
  },
);

ruleTester.run("custom/no-direct-white-colors", noDirectWhiteColors, {
  valid: [
    {
      code: `function C() { return <p className="text-foreground">x</p>; }`,
    },
    {
      code: `function C() { return <p className="bg-secondary">x</p>; }`,
    },
  ],
  invalid: [
    {
      code: `function C() { return <p className="text-white">x</p>; }`,
      errors: 1,
    },
    {
      code: `function C() { return <div className="bg-white/80">x</div>; }`,
      errors: 1,
    },
  ],
});

// Sanity assertion to make this file a valid vitest spec — the RuleTester
// blocks above register their own cases; this just confirms the file ran.
describe("eslint custom rules suite", () => {
  it("registered RuleTester cases for all 11 custom rules", () => {
    expect(true).toBe(true);
  });
});
