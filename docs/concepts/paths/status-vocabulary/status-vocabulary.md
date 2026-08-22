---
layer: golden-path
subject: status-vocabulary
status: forged
techniques:
  - vocabulary-chain-integrity
  - status-color-mapping
  - number-formatting
  - timestamp-display
  - untrusted-label-rendering
  - vocabulary-evolution-checklist
  - token-label-separation@i18n
evidence:
  - src/i18n/tokenMaps.ts                                              # the token→label resolver (layer 3→4); its dev-only unknown path is the w3-i18n deviation
  - src/lib/design/statusTokens.ts                                     # semantic status color palette — the color half of the presentation table
  - src/lib/design/eventTokens.ts                                      # best-typed presentation table: Record<wire-union, …> for color AND icon, shape-not-color rule in-source
  - src/features/overview/sub_certification/components/VerdictBadge.tsx # the only file doing the whole chain; its docstring is a drift post-mortem
  - src/features/shared/components/display/Numeric.tsx                  # the one number renderer — locale bound INSIDE it (the ~212-call-site fix, documented in its own prop docs)
  - src/features/shared/components/display/RelativeTime.tsx             # the elapsed-moment primitive on the one shared self-scaling ticker
  - src/lib/utils/formatters.ts                                         # activeLanguage()-in-the-formatter fix; formatCost/formatPercent/formatCount; EXECUTION_STATUS_MAP fallback discipline
  - src-tauri/db/src/migrations/incremental/                          # 82 CHECK(col IN (…)) write guards — 66 unique closed vocabularies at the storage layer
counter_evidence:
  - src/features/overview/sub_observability/components/HealingIssueStatusBadge.tsx # exemplary variant-prop shape; renders {issue.severity} raw and hardcodes seven English strings
  - eslint-rules/prefer-numeric.cjs                                     # the gate that sees ~5 of ~141 display-intent sites — an enclosing arrow function aborts the check
deviations:
  - w11-status-vocabulary   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-i18n            # tokenLabel's unknown-token path is dev-only; raw tokens render silently in production
  - w3-design-tokens   # severity-accent vocabulary duplicated 3× — the palette decay this subject's color technique names
  - w2-realtime-events # six event names minted outside both registries — the chain-drift evidence class at the wire layer
  - w5-alerting        # two evaluators of one alert vocabulary honoring different scope fields — vocabulary consumed off two authorities
---

# Status vocabularies & display formatting

Everything a person reads in a product began life as something a machine
wrote: a member of a closed vocabulary (`queued`, `critical`, `approved`),
a raw quantity (a cost as a float, a moment as an epoch), or a string typed
by an author the product does not control. None of these is displayable as
it stands. Between the stored value and the rendered pixels there is a
boundary crossing — value to presentation — and this subject is the
discipline of that crossing: **who owns each rendering decision, and what
happens when a value the display layer did not anticipate arrives.**

The two halves of the subject share one law. A closed vocabulary (a status
set) and an open one (any number, any moment, any untrusted string) fail
the same way when a call site makes the presentation decision locally: the
decision gets made hundreds of times, each copy drifts independently, and
no gate can see the disagreement because every copy is internally
consistent. The cure is also shared — a single authority per vocabulary, a
single renderer per quantity class, and the hard cases (unknown member,
zero, the future, hostile text) handled *inside* the authority so no call
site can get them wrong.

## A status is one vocabulary crossing four layers

A status that reaches a user's eye has crossed four layers, and each is a
different artifact with a different owner:

1. **Storage constraint** — the persistence layer rejects values outside
   the member set. A write guard, nothing more: nothing downstream can
   *read* a constraint, so a vocabulary defined only here is safe in the
   database and broken on screen.
2. **Wire token** — the machine identifier crossing process boundaries,
   ideally as a generated closed type both sides can check. This is the
   only artifact in the chain that producer and consumer can *both*
   typecheck, which makes it the chain's real contract.
3. **Label catalog** — what each locale calls each member, keyed by the
   token. The catalog is derived from the vocabulary; when the vocabulary
   grows, the catalog grows in the same change or a raw token ships.
4. **Rendered presentation** — the badge, pill, or cell: a translated
   label plus a semantic color role plus a shape, resolved from **one**
   table keyed by the wire type.

Each layer either **derives from one authority** — the typed definition at
the source of writes — or it drifts
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)).
And the machine token is **never displayed raw**: `dead_letter` in a badge
is the system's internal vocabulary leaking into the user's field of view,
in every language at once. The full chain discipline, and the drift gates
between the layers, are
[vocabulary-chain-integrity](techniques/vocabulary-chain-integrity.md);
the boundary between token-as-identity and label-as-presentation is the
shared [token-label-separation](../i18n/techniques/token-label-separation.md)
technique, owned by [i18n](../i18n/i18n.md).

What this subject does **not** own: which member may follow which — the
transition rules of a lifecycle — belongs to
[entity-lifecycle](../entity-lifecycle/entity-lifecycle.md); codes that
describe a *failure* and route through error resolution belong to
[error-handling](../error-handling/error-handling.md); the catalog
machinery itself to [i18n](../i18n/i18n.md). This subject owns codes that
describe a *state* and everything about how state, quantity, and moment
become pixels.

## Color is a token-mediated coupling

Status color is where two closed vocabularies meet: the status set and the
[design-token](../design-tokens/design-tokens.md) color roles. The mapping
runs **vocabulary → semantic role → themed value** — never vocabulary →
hex at the call site. A hand-picked green beside a status string is two
authorities colluding without a contract: it will miss the theme switch,
the contrast floor, and the day the vocabulary gains a member.

The structural rule is one presentation table per vocabulary, keyed by the
wire type, carrying the color role *and* the label key together — because
two parallel tables (one for color, one for labels) drift precisely when a
member is added to one of them. And the table needs a decided **unknown
direction**: an unrecognized token degrades *toward the value that demands
attention, never toward the calm one*. A token you do not know is a token
you cannot vouch for; rendering it green and rendering its raw spelling
are the same lie told two ways. All of this is
[status-color-mapping](techniques/status-color-mapping.md).

## Numbers have one renderer

A number a person reads is not the number — it is a rendering in a
convention the reader's locale owns: separators, grouping, symbol
position, sign placement. So the product has **one numeric primitive**,
and the locale is bound **inside** it, not passed by its callers. This is
the subject's most expensive measured lesson: a primitive that *accepts* a
locale but *defaults* it is locale-blind with extra steps, because the
default is what ships — one repo measured ~96% of call sites taking the
default in a fourteen-language product, under a green gate, and **a single
edit binding the active locale inside the primitive corrected ~212 call
sites at once**. Rounding, units, zero-versus-unknown, and compact
notation are all the primitive's decisions too:
[number-formatting](techniques/number-formatting.md).

## Moments have one policy

A stored moment is a point on the timeline; what a person reads is a
projection of it through a timezone, a locale, and a style — and any
render that does not supply those inputs has taken them from the host
machine, silently. The house policy is: **relative by default, absolute
one hover away**, elapsed labels refreshed by **one shared, self-scaling
ticker** (never a per-cell timer), the elapsed vocabulary taken from the
platform rather than authored per call site, and the future clamped —
clock skew and misparsed instants otherwise render as durations that have
not happened yet. [timestamp-display](techniques/timestamp-display.md).

## Untrusted text is escaped by the primitive

Labels and badges routinely carry text the repo did not author — entity
names, model output, imported titles. The display primitive renders these
as **text, never markup**, so safety is a property of the rendering layer
rather than a per-call-site review item; and untrusted text never becomes
vocabulary — logic, color, and identity key on tokens, never on content.
[untrusted-label-rendering](techniques/untrusted-label-rendering.md) owns
the display half; the deeper treatment of hostile content is
[prompt-safety](../prompt-safety/prompt-safety.md)'s
[output-sanitization](../prompt-safety/techniques/output-sanitization.md).

## Evolution is a checklist

The four-layer structure has a cost, and it is paid on every change:
adding one status member touches all four layers, in one change, or the
chain drifts at whichever layer was forgotten — and the forgotten layer
fails silently (a grey pill, an untranslated token, a write the storage
still rejects). The discharge list — and the mirror lists for renaming and
retiring a member — is itself the technique:
[vocabulary-evolution-checklist](techniques/vocabulary-evolution-checklist.md).

## The techniques

- [vocabulary-chain-integrity](techniques/vocabulary-chain-integrity.md) —
  the four layers, one authority, and the drift gates between them; why a
  storage constraint is a write guard rather than a contract; making label
  coverage a compile error.
- [status-color-mapping](techniques/status-color-mapping.md) — one
  presentation table keyed by the wire type, semantic color roles, the
  unknown-member direction, shape-not-color-alone, and when a shared
  palette earns existence.
- [number-formatting](techniques/number-formatting.md) — one renderer with
  the locale bound inside it; units as part of the value; rounding as a
  contract about loss; zero, unknown, and too-small as three facts.
- [timestamp-display](techniques/timestamp-display.md) — elapsed versus
  fixed-moment; the shared ticker; the platform's elapsed vocabulary;
  clamping the future; the host-machine default trap.
- [untrusted-label-rendering](techniques/untrusted-label-rendering.md) —
  escape-by-default display, one markdown door, and why untrusted text
  never becomes vocabulary.
- [vocabulary-evolution-checklist](techniques/vocabulary-evolution-checklist.md) —
  adding, renaming, and retiring members as four-layer transactions.
- [token-label-separation](../i18n/techniques/token-label-separation.md)
  *(shared, owned by [i18n](../i18n/i18n.md))* — tokens are identity,
  labels are presentation; the mapping layer between them; the
  unknown-token path as part of the design.
