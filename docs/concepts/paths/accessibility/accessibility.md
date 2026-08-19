---
layer: golden-path
subject: accessibility
status: forged
techniques:
  - primitive-level-a11y
  - keyboard-navigation-models
  - live-region-architecture
  - name-and-description-wiring
  - preference-respect
  - a11y-verification
evidence:
  - src/features/shared/components/feedback/AriaLiveProvider.tsx    # one provider, polite+assertive persistent regions, serial drain queue, keyed remount for duplicate re-announcement, imperative door for non-component writers, timer reaped on unmount (WCAG 4.1.3 cited in-file)
  - src/features/shared/components/forms/AccessibleToggle.tsx       # the primitive contract in one file: native button, switch role + checked state property, REQUIRED label prop, Enter/Space, focus-visible ring, sr-only state text
  - src/hooks/utility/interaction/useRovingTabIndex.ts              # the shared roving-tabindex mechanism: arrows/Home/End, wrap, focus+selection moved together
  - src/features/templates/sub_generated/adoption/questionnaire/useQuestionnaireKeyboardNav.ts   # shortcut layer with the never-steal-typing guard on all three bindings (digits, Enter, arrows)
  - src/App.tsx                                                     # skip link (sr-only until focused, targets main content) as an early tab stop; AriaLiveProvider mounted exactly once at the shell; reduced-motion preference wired at the root
  - src/features/shared/chrome/sidebar/Sidebar.tsx                  # landmark navigation with accessible name; badge count changes announced via a visually-hidden polite region (translated sr strings)
  - src/lib/keyboard/ShortcutCheatSheet.tsx                         # shortcut discoverability: `?` cheat sheet rendered from the single shortcutRegistry authority
  - scripts/check-themes.mjs                                        # the contrast floor as a hard CI gate at the token-definition site: AA 4.5:1 across every theme, including the opacity-tinted caption edge
counter_evidence:
  - src/hooks/utility/interaction/useRovingTabIndex.ts              # same file, adoption half: zero consumers outside its own file — the canonical mechanism exists and composites hand-roll or omit arrow-key models
deviations:
  - w10-accessibility   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w7-drag-drop              # 0/26 drag surfaces keyboard-operable; DragHandle false affordance — anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-data-viz               # no chart carries a text equivalent
  - w3-toasts-notifications   # hover-only timer pause (keyboard focus doesn't hold a toast); double live-region announcement
  - w3-design-tokens          # derived custom themes bypass the contrast gate — user-authored themes ship below AA
---

# Accessibility

Accessibility is the discipline of keeping the product operable when a
channel is removed. Two removals define the subject operationally: turn
the screen off (non-visual operation, through a screen reader) and unplug
the pointer (keyboard-only operation). A product passes not when an audit
score is green but when a competent user can drive **every** journey to
completion under both removals — the same journeys, the same outcomes,
not a reduced "accessible version" bolted on beside the real one.

Two framings of this subject fail reliably, and naming them up front is
half the doctrine:

- **Accessibility as a feature** — something a team "adds" in a late
  milestone. It is not additive; it is a property of the interface
  contract, like correctness. A control either has an accessible name or
  it does not, the same way a function either handles its error path or
  does not.
- **Accessibility as compliance** — chasing a checklist score. The
  published standards (WCAG and the ARIA authoring practices) are the
  *shared vocabulary and the floor*: they let teams name failures
  precisely and set a testable minimum. But a product can satisfy every
  automated checkpoint and still be unusable with a screen reader,
  because the checkpoints observe attributes while users experience
  journeys. The standards calibrate the work; they are not the work.

What remains, once those framings are cleared, is a small set of load-
bearing claims. Each has a technique behind it.

## Accessibility is a property of primitives, not a retrofit

The single highest-leverage fact in this domain: **accessibility
multiplies through the component layer**. An accessible shared button,
toggle, table, or dialog makes every consumer accessible by default; an
inaccessible one converts the fix into an N-call-site campaign that will
never be scheduled and never complete. The retrofit project that audits
pages one by one is fighting the composition model of its own codebase —
every finding it fixes at a call site is re-introduced by the next
consumer of the same broken primitive.

The consequence for how work is organized: the accessibility review of a
mature product is **mostly a review of its primitive catalog** — a few
dozen components plus the rules for composing them — not a tour of its
hundreds of screens. A primitive earns its place in the shared layer only
by carrying the full contract: correct role, computable name, keyboard
operability, visible focus, announced state changes. The audit of which
primitives carry that contract, the native-first rule, and the ways
accessible primitives still compose into inaccessible screens are
[primitive-level-a11y](techniques/primitive-level-a11y.md).

This is a structural fix, not a disciplinary one, in exactly the sense of
[one-validation-door](../_laws.md#one-validation-door): enforcing the
contract at N call sites is enforcement minus the call site added next
quarter; enforcing it inside the one primitive all call sites pass
through is enforcement that survives growth.

## Keyboard equivalence is existence proof

> **An operation reachable only by pointer does not exist for some
> users.** Not "is harder" — does not exist. Hover-revealed actions,
> drag-only reordering, click targets that are not focusable: each is a
> capability the product has for one population and lacks for another.

Every operation therefore needs a keyboard path. Not necessarily the
*same* gesture — a drag has no keyboard translation, but "select, choose
destination, confirm" reaches the same outcome — an **equivalent** path
to the same end state.

And one failure mode is worse than absence: the **false affordance** — an
element styled as interactive, perhaps even focusable, that does nothing
when activated. Absence is at least honest; a false affordance consumes
the user's tab stops, their attention, and their trust, and teaches them
that the interface lies. The ban is absolute: if it looks operable and
takes focus, activation must do the thing, and if it cannot, it must not
look operable or take focus.

The models that make keyboard operation coherent at scale — tab moves
between widgets while arrows move within them, roving focus inside
composite widgets, shortcut design and discoverability, focus order,
escape hatches — are
[keyboard-navigation-models](techniques/keyboard-navigation-models.md).
The one place focus is deliberately *contained* rather than free is the
overlay stack, and that containment is owned by the modal subject —
[focus-and-scroll-containment](../modal-stack/techniques/focus-and-scroll-containment.md)
— this subject supplies the demand (focus must never be trapped except
there) and defers the mechanics.

## Announcements are engineered, not emitted

Visual state changes broadcast themselves — a spinner appears, a row
turns green, a count ticks up — and peripheral vision carries the news.
Non-visual output has no periphery: a state change reaches a screen
reader user only if the product **announces** it, and announcement is a
narrow, sharp-edged channel. The platform voices *mutations inside live
regions it already observes*; it voices the *last* write when several
race; it stays silent on text that arrives together with its region; it
will not re-voice a string that did not change. Every one of those edges
is a way for the product to believe it spoke while a user heard nothing.

So announcements are a piece of engineering, not a side effect: one
persistent provider mounted with the shell, a drain queue so bursts are
serialized instead of last-write-wins swallowed, deliberate re-announce
mechanics so a repeated message (same text, new event) is spoken again,
and politeness levels assigned by policy rather than per call site. That
infrastructure is [live-region-architecture](techniques/live-region-architecture.md).
The *delivery policy* for out-of-band messages — which severities
announce at which politeness, how announcement triage mirrors visual
toast triage — is owned by the notification subject at
[announcement-accessibility](../toasts-notifications/techniques/announcement-accessibility.md);
this subject owns the shared machinery that policy writes into.

## The accessible name is computed — wire the chain deliberately

Every control's **accessible name** — what a screen reader says, what a
voice-control user must speak — is computed by a precedence algorithm
over a chain of sources: explicit label references, label attributes,
associated visible labels, content, fallbacks. Products that treat this
computation as something that happens by accident ship icon-only buttons
named nothing, inputs named by their placeholder (which vanishes exactly
when the user starts acting), and errors that render in red but attach to
no field.

The chain is a **contract**: label, hint, and error are wired to the
control they describe so that the name and description compute correctly;
icon-only controls carry explicit names; the visible label and the
accessible name stay the same string so what users *see* is what voice
users can *say*. Field-level wiring — the id plumbing between a form
control and its label, hint, and error — is owned by the form subject at
[field-composition](../form/techniques/field-composition.md); the
app-wide rule (every control names itself, no exceptions, and names are
translated user-facing strings like any other copy —
[i18n](../i18n/i18n.md)) is
[name-and-description-wiring](techniques/name-and-description-wiring.md).

## Preferences are commitments, not signals

Users declare operating conditions at the system level: reduce motion,
increase contrast, scale text, force colors. Detecting these is trivial;
the discipline is that **detection creates an obligation across every
surface**, and a preference honored on nine screens and ignored on the
tenth is a broken promise precisely where the user is most vulnerable —
the vestibular user does not get to choose which screen triggers them.

The contract shape follows
[one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary):
each preference is read at one boundary and exposed as a single signal
that every surface derives from, never re-detected ad hoc per component —
because ad-hoc detection is exactly how the tenth screen gets missed.
Reduced motion in particular splits ownership: this subject owns the
*demand* (no non-essential motion when the preference is set, and
feedback replaced, never removed — an instant settle, not a missing
answer), while the mechanics of how the animation system honors it belong
to the motion subject. The contrast floor is grounded in the token
system, where a build-time gate can hold the line —
[token-enforcement](../design-tokens/techniques/token-enforcement.md).
The full contract — motion, contrast, text scale and reflow, forced
colors — is [preference-respect](techniques/preference-respect.md).

## Verification is testable — "accessible" is a decaying claim

An interface drifts toward inaccessibility by default: every new surface,
every refactor, every visual polish pass is an opportunity to drop a
name, steal a tab stop, or mount a live region too late — and none of
those regressions are visible to the sighted, mouse-driven developer who
ships them. A one-time audit therefore certifies only the past. The claim
"this product is accessible" is real only while **gates** keep it true:
automated audits in continuous integration (honest about their ~one-third
detection ceiling), unit tests that assert the *screen-reader-visible*
output — computed names, announcement sequences, focus destinations — a
contrast floor enforced where colors are defined, and scripted keyboard
walks that prove reachability. Each gate must observe the thing it
guards, not an attribute that correlates with it
([gate-sees-target](../_laws.md#gate-sees-target)) — a check that an
element *has* a live-region attribute passes on a region mounted too late
to ever speak. The layered verification stack, and what still requires a
human with a real screen reader, is
[a11y-verification](techniques/a11y-verification.md).

## Boundaries

This subject owns the **app-wide discipline**: the contracts every
surface must satisfy and the shared machinery (announcer, keyboard
models, name computation rules, preference signals, verification gates)
that makes satisfying them cheap. Neighboring subjects own their local
mechanics and are held to this subject's standard:

- **Overlay focus containment** — trap, restore, and scroll lock inside
  the layered overlay stack —
  [modal-stack](../modal-stack/modal-stack.md), specifically
  [focus-and-scroll-containment](../modal-stack/techniques/focus-and-scroll-containment.md).
- **Field wiring** — label/hint/error association inside form fields —
  [form](../form/form.md), specifically
  [field-composition](../form/techniques/field-composition.md).
- **Announcement delivery policy** for out-of-band messages —
  [toasts-notifications](../toasts-notifications/toasts-notifications.md),
  specifically
  [announcement-accessibility](../toasts-notifications/techniques/announcement-accessibility.md).
- **Motion mechanics** — how the animation layer implements reduced
  motion — the motion subject; this subject states the requirement it
  must meet.
- **Contrast ground truth** — the token pairs the contrast floor is
  computed over — [design-tokens](../design-tokens/design-tokens.md).

## The techniques

- [primitive-level-a11y](techniques/primitive-level-a11y.md) — the
  primitive contract, the catalog audit, native-first, and composition
  rules.
- [keyboard-navigation-models](techniques/keyboard-navigation-models.md) —
  tab-between/arrows-within, roving focus, shortcuts and discoverability,
  focus order, escape hatches, the false-affordance ban.
- [live-region-architecture](techniques/live-region-architecture.md) —
  one persistent provider, polite/assertive channels, drain queues for
  bursts, deliberate re-announcement.
- [name-and-description-wiring](techniques/name-and-description-wiring.md) —
  the name computation chain, icon-only controls, description and error
  association, label-in-name.
- [preference-respect](techniques/preference-respect.md) — reduced
  motion, contrast, text scale, forced colors: one signal per preference,
  every surface derives.
- [a11y-verification](techniques/a11y-verification.md) — audit layers,
  screen-reader-output assertions, the contrast gate, keyboard walks, and
  the human pass nothing replaces.
