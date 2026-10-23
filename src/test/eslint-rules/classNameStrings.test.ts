/**
 * The shared className walker (`eslint-rules/_classname-strings.cjs`) and the
 * depth it gives every design-token rule built on it.
 *
 * Before the walker was shared, no-raw-radius-classes, no-raw-shadow-classes and
 * no-raw-spacing-classes stopped at template literals, so a raw class inside
 * cn(), a `[..].join(' ')` or a ternary passed them while no-raw-text-classes
 * caught the same shape. These cases pin the four rules to one depth.
 */

import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
import { createRequire } from "node:module";
import tsParser from "@typescript-eslint/parser";

const require = createRequire(import.meta.url);

const classNameStrings = require("../../../eslint-rules/_classname-strings.cjs");
const noRawRadiusClasses = require("../../../eslint-rules/no-raw-radius-classes.cjs");
const noRawShadowClasses = require("../../../eslint-rules/no-raw-shadow-classes.cjs");
const noRawSpacingClasses = require("../../../eslint-rules/no-raw-spacing-classes.cjs");
const noRawTextClasses = require("../../../eslint-rules/no-raw-text-classes.cjs");

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

describe("_classname-strings", () => {
  it("exports the walker and the rule factory", () => {
    expect(typeof classNameStrings.extractClassStrings).toBe("function");
    expect(typeof classNameStrings.collectClassText).toBe("function");
    expect(typeof classNameStrings.createRawClassRule).toBe("function");
  });

  it("yields nothing for a value it cannot know statically", () => {
    expect(classNameStrings.extractClassStrings({ type: "Identifier", name: "cls" })).toEqual([]);
    expect(classNameStrings.extractClassStrings(null)).toEqual([]);
  });

  it("builds a rule whose meta carries the declared message", () => {
    const rule = classNameStrings.createRawClassRule({
      description: "d",
      messageId: "rawThing",
      message: 'no "{{ raw }}"',
      pattern: /\bthing-\d\b/,
    });
    expect(rule.meta.messages).toEqual({ rawThing: 'no "{{ raw }}"' });
    expect(rule.meta.schema).toEqual([]);
  });
});

ruleTester.run("custom/no-raw-radius-classes (deep className shapes)", noRawRadiusClasses, {
  valid: [
    { code: `function C({ on }) { return <div className={cn("rounded-card", on && "ring-1")}>x</div>; }` },
    { code: `function C({ on }) { return <div className={on ? "rounded-input" : "rounded-full"}>x</div>; }` },
    {
      // Shared primitives stay exempt whatever the className shape.
      code: `function C() { return <div className={cn("rounded-lg")}>x</div>; }`,
      filename: "src/features/shared/components/Thing.tsx",
    },
  ],
  invalid: [
    {
      code: `function C({ on }) { return <div className={cn("p-2", on && "rounded-lg")}>x</div>; }`,
      errors: [{ messageId: "rawRadiusClass", data: { raw: "rounded-lg" } }],
    },
    {
      code: `function C({ on }) { return <div className={on ? "rounded-md" : "rounded-card"}>x</div>; }`,
      errors: [{ messageId: "rawRadiusClass", data: { raw: "rounded-md" } }],
    },
    {
      code: `function C() { return <div className={["flex", "rounded-xl"].join(" ")}>x</div>; }`,
      errors: [{ messageId: "rawRadiusClass", data: { raw: "rounded-xl" } }],
    },
  ],
});

ruleTester.run("custom/no-raw-shadow-classes (deep className shapes)", noRawShadowClasses, {
  valid: [
    { code: `function C({ on }) { return <div className={clsx("shadow-elevation-2", on && "ring-1")}>x</div>; }` },
  ],
  invalid: [
    {
      code: `function C({ on }) { return <div className={clsx("flex", on && "shadow-lg")}>x</div>; }`,
      errors: [{ messageId: "rawShadowClass", data: { raw: "shadow-lg" } }],
    },
    {
      code: `function C({ on }) { return <div className={on ? "shadow-2xl" : "shadow-none"}>x</div>; }`,
      errors: [{ messageId: "rawShadowClass", data: { raw: "shadow-2xl" } }],
    },
  ],
});

ruleTester.run("custom/no-raw-spacing-classes (deep className shapes)", noRawSpacingClasses, {
  valid: [
    // Zero resets stay legal inside a helper call too.
    { code: `function C() { return <div className={cn("p-0", "flex")}>x</div>; }` },
  ],
  invalid: [
    {
      code: `function C({ on }) { return <div className={cn("flex", on ? "gap-3" : "gap-0")}>x</div>; }`,
      errors: [{ messageId: "rawSpacingClass", data: { raw: "gap-3" } }],
    },
  ],
});

ruleTester.run("custom/no-raw-text-classes (deep className shapes)", noRawTextClasses, {
  valid: [
    { code: `function C({ on }) { return <p className={cn("typo-body", on && "font-bold")}>x</p>; }` },
  ],
  invalid: [
    {
      code: `function C({ on }) { return <p className={cn("text-foreground", on && "text-xs")}>x</p>; }`,
      errors: [{ messageId: "rawTextClass", data: { raw: "text-xs", token: "typo-caption" } }],
    },
  ],
});
