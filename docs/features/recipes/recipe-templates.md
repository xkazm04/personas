# Recipe Template Substitution Spec

**Source**: `src-tauri/src/commands/recipes/crud.rs::render_template`
**Last revised**: 2026-04-28

This document is the contract between recipe authors and the execution engine for
how `{{placeholder}}` tokens are substituted at execution time. Any change to
`render_template` MUST update this spec and the matching unit tests.

## 1. Token grammar

A placeholder is **exactly** the regex `\{\{(\w+)\}\}`:

- Two opening braces, one capture group of one-or-more ASCII word characters
  (`[A-Za-z0-9_]`), two closing braces.
- Whitespace inside the braces (`{{ ticker }}`) does **not** match — the token is
  left as literal text in the rendered output.
- Hyphens, dots, slashes, and any non-ASCII letters do **not** match. A key like
  `user.name` cannot be substituted; flatten the key first.
- Names are **case-sensitive**: `{{Name}}` and `{{name}}` are different tokens.
- The scan is single-pass and **not recursive**. If the substituted value itself
  contains `{{...}}`, those braces remain literal in the output.

## 2. JSON value rendering

`input_data: HashMap<String, serde_json::Value>` is consulted for each match.

| JSON type        | Rendered form                                | Example input → output                |
|------------------|----------------------------------------------|---------------------------------------|
| `String`         | The raw string (no surrounding quotes)       | `"hello"` → `hello`                   |
| `Number` (int)   | Decimal representation                       | `42` → `42`                           |
| `Number` (float) | `serde_json::Value::to_string` form          | `1.5` → `1.5`                         |
| `Bool`           | `true` / `false`                             | `true` → `true`                       |
| `Null`           | `null`                                       | `null` → `null`                       |
| `Array`          | Compact JSON                                 | `[1,2,3]` → `[1,2,3]`                 |
| `Object`         | Compact JSON                                 | `{"k":"v"}` → `{"k":"v"}`             |

Strings are unwrapped (no surrounding quotes) so authors can write natural
prompts like `Hello {{name}}.`. All other JSON types are stringified via
`Value::to_string`, which **does** include quotes around any nested string. If
you need an array rendered as a comma-separated list of bare values, transform
the data in the recipe-execution pipeline before substitution — the renderer
deliberately does not know about presentation.

### 2.1 Null is allowed

`null` is **not** treated as missing. A key that exists in `input_data` with
value `Value::Null` renders as the literal string `null`. To force a missing
error, omit the key from `input_data` entirely.

## 3. Missing keys

If a key is absent from `input_data`, the placeholder is left **as-is** in the
rendered output (`{{name}}`). Before rendering, every recipe-execution path
calls `validate_required_inputs_present`, which derives the required-key set from
the **raw template** and diffs it against the supplied `input_data`, failing with
a `Validation` error listing the missing keys (deduped, in first-seen order).
Recipe authors will see the error message; the rendered prompt is never shipped
to the LLM.

Validation deliberately inspects the **template**, not the rendered output. A
re-scan of the output would be unsound because substitution is single-pass: a
supplied value that legitimately contains literal `{{x}}` text (a code snippet, a
mustache example, a quoted template) would survive into the rendered string and be
mistaken for an unreplaced placeholder, aborting an execution where every real
variable was actually provided.

## 4. Duplicate keys

`input_data` is a `HashMap`, so a key can only have one value at a time —
duplicates are impossible at this layer. If the upstream JSON contained
duplicate keys, `serde_json` resolves them with **last-write-wins** during
deserialization; by the time `render_template` sees the map, only the final
value remains.

## 5. Escape syntax

There is **no** escape syntax. Literal `{{` followed by `\w+` followed by `}}`
will always be substituted (or left in place if missing). To emit a literal
`{{key}}` in the output, use a placeholder that does not match the regex:
include whitespace (`{{ key }}`), punctuation (`{{key.}}`), or wrap one of the
braces in a value, e.g. `{{open}}key{{close}}` with `open="{{"` and
`close="}}"` — but note that the substituted braces are not re-scanned, so this
is safe.

## 6. Stability guarantees

- The token grammar (regex) is part of the public contract. Widening it
  (adding hyphens, dots, etc.) is a **breaking change** for recipe authors and
  requires a migration plan.
- Adding new JSON types or new render forms is non-breaking only if existing
  authored recipes continue to render identically.
- The two render call-sites (`execute_recipe`, `start_recipe_execution`) MUST
  share the same renderer; do not fork.

## 7. Tests

Behavior is pinned by `crud::tests::render_template_*` and
`validate_required_inputs_present_*` in `src-tauri/src/commands/recipes/crud.rs`.
