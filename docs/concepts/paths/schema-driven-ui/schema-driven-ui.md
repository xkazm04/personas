---
layer: golden-path
subject: schema-driven-ui
status: forged
techniques:
  - node-vocabulary-design
  - registry-mapping
  - spec-validation-and-repair
  - action-consent-wiring
  - host-capability-injection
  - emitter-registry-sync
evidence:
  - src/features/shared/components/surface/surfaceSpec.ts            # closed node vocabulary, validation door, salvage/repair with dropped count
  - src/features/shared/components/surface/SurfaceRenderer.tsx       # blessed-primitives-only realization, consent-gated actions, host capability context
  - src/features/shared/components/surface/SPEC.md                   # emitter-facing vocabulary documentation beside the schema authority
  - src/features/home/sub_cockpit/widgetRegistry.ts                  # kind→component registry for agent-composed dashboard widgets
  - src/features/home/sub_cockpit/CockpitPanel.tsx                   # spec-as-data rendering: parse-failure ≠ empty, unknown-kind handling, action re-validation on render
  - src-tauri/src/companion/brain/cockpit.rs                         # persisted spec blob, write lock over read-modify-write, pin-preserving recomposition merge
  - src/features/home/sub_cockpit/widgets/__tests__/UseCaseSetWidget.test.tsx  # widget contract pinned by tests: config in, rendered surface out
counter_evidence: []
deviations:
  - w7-schema-driven-ui   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w4-prompt-assembly                # cockpit widget kinds not validated at dispatch; emitter doctrine hand-synced to the registry
---

# Schema-driven UI rendering

Schema-driven UI is the pattern where **a piece of data describes a layout, and a
renderer realizes that description from a registry of blessed components**. The
spec says *what* to show — a heading, a metric row, a list of items, a proposed
action — and the renderer decides *how*, by mapping each described node onto a
component the design system already owns. The spec is content; the components
are craft; the registry is the border between them.

Reach for this pattern when the composer of the surface is not the author of the
code:

- **A model composes the surface.** An assistant summarizes a situation and
  wants to show it as structured panels rather than prose. The model emits a
  spec; the renderer realizes it. (How the spec is extracted and shaped from a
  model turn is owned by [structured-output](../structured-output/structured-output.md);
  this subject begins where a candidate spec already exists.)
- **The surface is user- or agent-configurable.** A dashboard whose tiles are
  chosen, arranged, pinned, and removed at runtime — the arrangement is data,
  persisted and edited, not a build-time layout.
- **The surface travels.** The same described content renders in different
  hosts (a desktop pane, a narrow companion view, an export) because the
  description carries no host-specific rendering.

Do *not* reach for it when one team authors both the layout and the code and the
layout is stable: a spec layer between you and your own screen is indirection
with no second author to serve. Schema-driven UI earns its cost exactly when the
composer and the implementer are different parties with different trust levels.

That phrase — different trust levels — is the heart of the subject.

## The spec is untrusted input, including your own model's

A renderer that accepts arbitrary node types, arbitrary markup, or arbitrary
style from a spec is an injection surface wearing a component tree. It does not
matter that the emitter is "our own model" or "our own agent": model output is
influenced by everything in its context, including content that arrived from
outside, so the spec channel inherits the trust level of the *least* trusted
thing upstream of the emitter. The renderer's posture is therefore the same as
any parser at a trust boundary:

1. **The node vocabulary is closed.** The spec chooses among a finite,
   versioned set of node kinds. There is no raw-markup kind, no style
   pass-through, no "custom component" escape hatch. A kind the renderer does
   not know is not rendered — and not silently skipped either (see repair,
   below). The vocabulary and its discipline are
   [node-vocabulary-design](techniques/node-vocabulary-design.md).
2. **Rendering maps onto blessed primitives only.** Each kind resolves through
   a registry to a component the design system already reviewed — with its own
   spacing, typography, empty states, and accessibility. The spec selects and
   parameterizes; it never injects appearance. This keeps the emitted surface
   indistinguishable in quality from a hand-built one, which is the entire
   point. The mapping machinery is [registry-mapping](techniques/registry-mapping.md).
3. **Validation happens at one door.** Every spec — freshly emitted, loaded
   from storage, edited by a human — passes through the same validation and
   repair pass before rendering. Not per-widget, not "the emitter already
   checked": one door, enumerable writers.

## Repair is honest

Specs arrive damaged. Emitters hallucinate kinds, omit required fields, nest
past sensible depth, and truncate mid-document. The renderer's contract for a
damaged spec is **salvage plus disclosure**:

- render every node that validates;
- drop what does not;
- and *say so*, in the surface itself — "3 sections shown, 1 could not be
  displayed" — with the count carrying its predicate.

Silent best-effort is the tempting alternative and it is worse than either
extreme. A surface that silently drops the fourth section teaches the user that
the system shows everything, then quietly doesn't; the person acting on the
summary never learns a section existed. Refusing the whole spec over one bad
node is the other failure — throwing away three good sections to punish one bad
one. Honest repair threads between them, and doubles as the feedback signal
that improves the emitter: every disclosed drop is a measurable defect with a
reason attached. And when nothing renderable survives at all, the surface
falls back to the ordinary display channel — the plain prose rendering the
output would have gotten with no spec — rather than a dead end: the spec
channel is progressive enhancement over the display channel, never a
replacement for it. The full discipline — structural passes, caps, drop
accounting — is [spec-validation-and-repair](techniques/spec-validation-and-repair.md).

## Actions are proposals, never invocations

A spec may *propose* actions — "retry this job", "open that record", "apply
this fix" — but a spec never executes anything by being rendered. Rendering is
pure realization; the action a node carries is a reference into an allowlisted
action vocabulary, resolved by the host, and armed only through the same
consent gate every other machine-initiated action passes (owned by
[hitl-approval](../hitl-approval/hitl-approval.md), specifically
[consent-gates](../hitl-approval/techniques/consent-gates.md)). The wiring — action
references, parameter discipline, disarm-by-default — is
[action-consent-wiring](techniques/action-consent-wiring.md).

This is the rule that keeps the injection analysis tractable. If rendering can
never cause execution, then a hostile or confused spec can at worst show wrong
content and propose wrong buttons — recoverable embarrassments. The moment a
node kind executes on mount, every upstream influence on the emitter becomes a
remote-execution vector.

## The renderer owes the host nothing and asks it for everything

The renderer is a pure function of two inputs: the spec, and a **capabilities
object the host hands it** — data fetchers, action handlers, navigation,
formatting. It imports nothing from application state and reaches into no
global store. Consequences, all load-bearing:

- **Testable**: render any spec against stub capabilities and assert the tree.
- **Portable**: the same renderer serves the desktop pane, the compact
  companion view, and the preview-in-isolation harness, each host injecting
  its own capabilities.
- **Least privilege**: the spec can only reach what the host chose to hand
  over — the capability surface is itself a closed vocabulary, the second
  allowlist after the node kinds.

The injection discipline is [host-capability-injection](techniques/host-capability-injection.md).

## The spec is a document with a lifecycle

Because the spec is data, it gets persisted, versioned, and edited — often by
two authors at once (an agent recomposing, a human pinning). That forces
document disciplines onto what looks like a UI concern: stable node identities
that survive recomposition, read-modify-write with write locks instead of
last-writer-wins, and a vocabulary version stamped on every stored spec. And it
forces one more authority rule: the emitter's documented vocabulary — the thing
the composing model is told it may emit — must be *derived from the registry*,
not hand-maintained beside it, or the two drift apart precisely when a kind is
added. Keeping the emitter's documentation synced to the registry is the
prompt-side's job (prompt-assembly, its capability-documentation technique);
the rendering side's half of the handshake is
[emitter-registry-sync](techniques/emitter-registry-sync.md).

## The techniques

- [node-vocabulary-design](techniques/node-vocabulary-design.md) — the closed
  set of kinds: granularity, versioning, composition rules, and the
  unknown-kind policy, decided once and stated.
- [registry-mapping](techniques/registry-mapping.md) — the kind→component
  registry as the single mapping authority: registration shape, per-kind
  config validation, per-kind degraded states.
- [spec-validation-and-repair](techniques/spec-validation-and-repair.md) — the
  one validation door: structural passes, depth and size caps, salvage
  semantics, and the dropped-N disclosure.
- [action-consent-wiring](techniques/action-consent-wiring.md) — actions as
  allowlisted proposals, consent-gated execution, disarm-by-default.
- [host-capability-injection](techniques/host-capability-injection.md) — the
  store-free renderer and the host-supplied capability object.
- [emitter-registry-sync](techniques/emitter-registry-sync.md) — one authority
  for the vocabulary across emitter and renderer, version handshakes, and
  write discipline when agent and human edit the same stored spec.
