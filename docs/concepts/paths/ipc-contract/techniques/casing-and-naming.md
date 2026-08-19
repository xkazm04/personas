---
layer: technique
subject: ipc-contract
technique: casing-and-naming
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target, count-carries-predicate]
shared_with: []
---

# Casing and naming

Each language world has a native casing culture for identifiers, and the
serialization layer between them can rename fields in transit — automatic
conversions, per-field declared renames, per-type annotations. The wire
therefore carries a **third naming convention** that neither world's source
code displays. Nobody reads the wire. That is why casing drift is the
quietest defect on the boundary: this technique is about making the wire's
names a stated contract instead of an emergent accident, and making call
names checkable instead of free-floating strings.

## The silent-null failure

A mis-cased field does not throw. On most deserializers a field the consumer
spelled differently than the producer simply *fails to match*: it lands as
absent, null, or the type's default. No error, no log — a value that is
quietly zero, an optional that is quietly empty, a flag that is quietly
false. The defect surfaces far from the boundary, as wrong behavior in
whatever logic consumed the default, and the investigation starts everywhere
except the true cause.

Worse, the conversion machinery is often **asymmetric**: arguments crossing
in one direction pass through an automatic rename layer while payloads
crossing back do not, or one enclosing layer converts and a nested layer
does not. A field can round-trip correctly at one call and silently vanish
at another, which defeats the "we tested one call, casing works" induction.

## The prescriptions

1. **Declare the wire casing once, globally.** One convention for every
   field of every crossing shape, stated in the contract documentation and
   configured in one place on the serializing side — a global serializer
   setting, not per-type annotations. Per-type and per-field renames are
   drift seeds: each is a little private treaty that the next shape will not
   know about. Exceptions must be zero or carry a written reason.
2. **Let the generator translate.** When shapes are generated across the
   boundary (the [generated-type-contracts](generated-type-contracts.md)
   technique), the generator knows the wire casing and emits the consumer's
   declarations *already matching it* — casing agreement becomes machinery
   output instead of human recall. This is the vocabulary law applied to
   spelling: one authority for how names cross
   ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
3. **Refuse unknown fields at development-time boundaries.** Strict
   deserialization — unknown field, hard error — converts the silent null
   into a loud failure at the exact crossing that caused it. Strictness in
   production is a product decision (tolerant readers have their place);
   strictness in development and test is where the detection value lives,
   and a gate that never sees a strict decode never sees the drift
   ([gate-sees-target](../../_laws.md#gate-sees-target)).

## Call names are a vocabulary, not strings

Most transports address operations by name, and the naive call site spells
that name as a string literal. A renamed or deleted operation then leaves
stale literals that compile perfectly and fail at runtime — name drift, the
cheapest-to-prevent drift of the four. The fix is mechanical: **generate the
name vocabulary as constants** from the side that registers the handlers,
and require call sites to reference the constant. The compiler (or a lint on
raw-string invocation) then makes an unknown name a build-time impossibility,
and "which operations exist" is one generated file instead of an
archaeology project. The set-parity consequences — declared vs registered vs
invoked — belong to [command-registration](command-registration.md).

## Ratchets over a legacy corpus

A boundary that grew before these rules will hold a mixed corpus: renamed
fields, per-type exceptions, raw-string call names. Bulk conversion is
high-risk precisely because casing defects are silent — a mass rename that
misses one consumer produces a silent null, and it produces it in code the
migration did not touch. The honest instrument is a **ratchet**: measure the
current violation count with a stated predicate ("N crossing shapes with
per-type rename annotations, counted by this expression" —
[count-carries-predicate](../../_laws.md#count-carries-predicate)), commit
the number, and gate on *no growth*. Shrink opportunistically, convert
shape-by-shape with a strict decode test per conversion, and let the ratchet
guarantee the direction. A frozen baseline with a no-growth gate beats a
heroic migration in every dimension except bragging rights.
