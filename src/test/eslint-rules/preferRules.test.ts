/**
 * RuleTester coverage for the four `prefer-*` adoption rules, which steer a raw
 * pattern toward one shared component and had no cases of their own.
 *
 * They are four rules, not one table, because they match four different shapes
 * (a member read, a call rendered as JSX text, and two className signatures);
 * the reasoning is in the header of `eslint-rules/_classname-strings.cjs`. The two
 * className rules read classes through that shared walker, so their cases pin the
 * walker's depth too: `cn()` arguments and `[..].join(' ')` are followed, an
 * unknown helper's arguments are not.
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import { createRequire } from "node:module";
import tsParser from "@typescript-eslint/parser";

const require = createRequire(import.meta.url);

const preferSharedClipboard = require("../../../eslint-rules/prefer-shared-clipboard.cjs");
const preferNumeric = require("../../../eslint-rules/prefer-numeric.cjs");
const preferStatusBadge = require("../../../eslint-rules/prefer-status-badge.cjs");
const preferSectionCard = require("../../../eslint-rules/prefer-section-card.cjs");

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

ruleTester.run("custom/prefer-shared-clipboard", preferSharedClipboard, {
  valid: [
    { code: `async function f() { return navigator.clipboard.readText(); }` },
    {
      // The shared hook owns the one real call.
      code: `function copy(s) { return navigator.clipboard.writeText(s); }`,
      filename: "src/hooks/utility/interaction/useCopyToClipboard.ts",
    },
  ],
  invalid: [
    {
      code: `function copy(s) { navigator.clipboard.writeText(s); }`,
      errors: [{ messageId: "preferShared" }],
    },
    {
      code: `function copy(w, s) { w.navigator.clipboard.writeText(s); }`,
      errors: [{ messageId: "preferShared" }],
    },
  ],
});

ruleTester.run("custom/prefer-numeric", preferNumeric, {
  valid: [
    // Logic-context formatting is not display.
    { code: `function f(v) { return "cost=" + v.toFixed(2); }` },
    // An attribute value is a prop, not rendered text.
    { code: `function C({ v }) { return <Bar width={v.toFixed(0)} />; }` },
    // Dates belong to the time primitives, not <Numeric>.
    { code: `function C({ t }) { return <span>{new Date(t).toLocaleString()}</span>; }` },
    // A number handed to another call is string-building.
    { code: `function C({ v, tx }) { return <span>{tx(v.toFixed(1))}</span>; }` },
  ],
  invalid: [
    {
      code: `function C({ v }) { return <span>{v.toFixed(2)}</span>; }`,
      errors: [{ messageId: "preferNumeric", data: { method: "toFixed" } }],
    },
    {
      code: `function C({ xs }) { return <ul>{xs.map((i) => <li key={i}>{i.toLocaleString()}</li>)}</ul>; }`,
      errors: [{ messageId: "preferNumeric", data: { method: "toLocaleString" } }],
    },
  ],
});

ruleTester.run("custom/prefer-status-badge", preferStatusBadge, {
  valid: [
    // Near-miss opacity: a count badge at /15 is a judgment call, not a reimplementation.
    { code: `function C() { return <span className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">3</span>; }` },
    // An alert region borrows the colours but is not an inline badge.
    { code: `function C() { return <div role="alert" className="bg-red-500/10 text-red-400 border-red-500/20">x</div>; }` },
    // Block padding marks a banner/panel.
    { code: `function C() { return <div className="p-3 bg-amber-500/10 text-amber-400 border-amber-500/20">x</div>; }` },
    // Only span/div are inspected.
    { code: `function C() { return <p className="bg-blue-500/10 text-blue-400 border-blue-500/20">x</p>; }` },
    // An unknown helper's arguments are not knowable class strings (shared walker).
    { code: `function C() { return <span className={badge("bg-cyan-500/10 text-cyan-400 border-cyan-500/20")}>x</span>; }` },
    {
      // The primitive itself.
      code: `function C() { return <span className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">x</span>; }`,
      filename: "src/features/shared/components/display/StatusBadge.tsx",
    },
  ],
  invalid: [
    {
      code: `function C() { return <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>; }`,
      errors: [{ messageId: "preferBadge", data: { kind: "variant", name: "success" } }],
    },
    {
      code: `function C({ on }) { return <span className={cn("bg-violet-500/10 text-violet-400", on && "border-violet-500/20")}>Beta</span>; }`,
      errors: [{ messageId: "preferBadge", data: { kind: "accent", name: "violet" } }],
    },
    {
      // `[..].join(' ')` is followed by the shared walker.
      code: `function C() { return <span className={["bg-blue-500/10", "text-blue-400", "border-blue-500/20"].join(" ")}>Info</span>; }`,
      errors: [{ messageId: "preferBadge", data: { kind: "variant", name: "info" } }],
    },
  ],
});

ruleTester.run("custom/prefer-section-card", preferSectionCard, {
  valid: [
    // Missing the border half of the shell.
    { code: `function C() { return <div className="rounded-xl bg-secondary/30 p-4">x</div>; }` },
    // Only a div is a card shell.
    { code: `function C() { return <section className="bg-secondary/30 border border-primary/12">x</section>; }` },
    {
      code: `function C() { return <div className="bg-secondary/30 border border-primary/12">x</div>; }`,
      filename: "src/features/shared/components/layout/SectionCard.tsx",
    },
  ],
  invalid: [
    {
      code: `function C() { return <div className="rounded-xl border border-primary/12 bg-secondary/30 p-4">x</div>; }`,
      errors: [{ messageId: "preferCard" }],
    },
    {
      code: `function C({ on }) { return <div className={cn("bg-secondary/30", on && "border border-primary/12")}>x</div>; }`,
      errors: [{ messageId: "preferCard" }],
    },
  ],
});
