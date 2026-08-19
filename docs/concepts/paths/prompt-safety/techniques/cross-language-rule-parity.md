---
layer: technique
subject: prompt-safety
technique: cross-language-rule-parity
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target]
shared_with: []
---

# Cross-language rule parity

The trust boundary rarely lives in one runtime. Input is captured and
previewed in the interface layer; prompts are assembled and dispatched in the
backend; output is masked before backend logging *and* before frontend
rendering. The same rule — "this is a secret shape", "this scheme is
forbidden", "this span is oversized" — must hold on both sides of the language
boundary, which means it will be **implemented twice**. This technique is the
discipline that keeps two implementations from becoming two rule sets.

## Why duplication happens and why it rots

The duplication is not laziness; it is usually forced. The rendering side must
mask before pixels without a round-trip; the backend must mask before a log
write the frontend never sees. A single shared implementation is often
impossible (different runtimes) or undesirable (a network hop inside a log
call). So the honest framing is: **the rule set is one artifact; the
implementations are two derivations of it.**

Left undisciplined, the derivations drift in a specific, predictable way: a
new secret pattern is added where the incident happened — the log leak gets
fixed in the backend matcher, the screen leak in the frontend one — and six
months later the two matchers agree on the original corpus and disagree on
everything learned since. Drift is invisible in normal operation because each
side only ever grades its own homework. The failure surfaces as an
asymmetric leak: masked on screen, raw in the log file — precisely the
surface nobody watches.

This is [one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
with the vocabulary being *the sanitization rules themselves*: two
hand-maintained copies of one rule set are not redundancy, they are a race
with a delay fuse.

## The parity kit

Three artifacts turn "please keep them in sync" into a structure:

1. **One authoritative specification.** The rule set is written down once, as
   data or as documentation-with-teeth: each rule named, with its intent, its
   pattern or predicate, and the incident or reasoning that earned it a slot.
   Both implementations cite rule names; a matcher clause that corresponds to
   no named rule is a defect, and so is the reverse.
2. **Mirror-marked implementations.** Each implementation carries an explicit
   marker — a comment block, a lint-recognizable tag — declaring "this mirrors
   rule set R; its sibling lives at the other side of the boundary; change
   both or change neither." The marker converts tribal knowledge into
   something a reviewer and a grep can find.
3. **Shared test vectors as the drift gate.** The load-bearing artifact: one
   corpus of input/expected-output pairs — hostile fixtures, boundary cases,
   the regression from every incident — consumed by *both* test suites. A
   rule added on one side makes the shared corpus grow; the sibling's suite
   then fails until the sibling learns the rule. The gate sees the actual
   divergence ([gate-sees-target](../../_laws.md#gate-sees-target)) rather
   than a proxy like "both files were touched in the same change."

The corpus is the piece teams skip, and it is the only one that *enforces*
anything. Spec and markers inform humans; the corpus fails builds.

## Semantics drift even when rules match

The subtle tier of this technique: two implementations of the same pattern on
the same input can disagree because the *runtimes* disagree — string length
counted in bytes here and code points there, regex dialects with different
class semantics, case-folding rules that diverge on non-ASCII, normalization
applied on one side only. Parity therefore includes the boring contracts:

- fix the unit (bytes vs characters) per rule, explicitly, and test at the
  boundary where they diverge (multi-byte text around the clamp ceiling);
- restrict patterns to the dialect subset both engines interpret identically,
  or generate each side's pattern from the spec;
- normalize text the same way, at the same stage, on both sides — an
  un-normalized comparison on one side is a rule that agrees in the test
  corpus (usually ASCII) and diverges in production (never ASCII).

Include non-ASCII, mixed-encoding, and ceiling-straddling cases in the shared
corpus for exactly this reason: the corpus must test the runtimes'
disagreements, not just the rules' agreements.

## Scope: any rule the boundary states twice

Secret masking is the canonical case, but the technique owns every rule the
trust boundary needs on both sides: scheme allowlists (previewed links and
dispatched links), length ceilings (an input counter in the interface and the
clamp at the assembly door — see
[input-caps-and-clamps](input-caps-and-clamps.md)), markup neutralization
(storage-side and render-side — see
[output-sanitization](output-sanitization.md)). The test for whether a rule
belongs here is one question: *if the two sides disagreed, would anything
fail loudly?* If the answer is no, the rule needs the parity kit.
