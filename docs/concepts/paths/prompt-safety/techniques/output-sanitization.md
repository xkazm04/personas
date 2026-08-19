---
layer: technique
subject: prompt-safety
technique: output-sanitization
status: forged
laws: [one-validation-door, failure-not-empty-success]
shared_with: []
---

# Output sanitization

The outbound half of the trust boundary, for **text surfaces**: everything the
model authors is untrusted input to whatever reads it next — a renderer, a log
pipeline, a database, a terminal, a pair of human eyes. Each of those readers
is an interpreter with its own injection grammar, and model output must be
made inert in each grammar it enters. (When output drives *actions* rather
than surfaces, the sibling technique
[model-output-as-untrusted](model-output-as-untrusted.md) takes over.)

The organizing question for every sink is: **what does this surface execute?**
A markup renderer executes markup. A terminal executes escape sequences. A log
pipeline executes newlines (as record boundaries) and secrets (as
disclosures). A human executes links by clicking them. Sanitization is
per-sink because the grammars differ; a pass that makes text safe for one
interpreter can leave it live for another.

## Secret masking — before display, before log, before storage

The highest-value single rule: **model output is scanned for secrets before it
reaches any persistent or visible surface.** Models recall what their context
held; a run whose context legitimately contained a credential, a token, or a
key can reproduce it — verbatim, or lightly reformatted — in prose, under
persuasion or by accident. Masking discipline:

- **Two detector families, both on.** Pattern-based detection catches known
  secret *shapes* (issuer prefixes, bearer formats, key-block framing,
  high-entropy runs in suspicious positions); value-based detection catches
  the secrets the application itself holds custody of — the vault's own
  values, matched exactly, however they are framed. Patterns catch strangers'
  secrets; value matching catches your own even when no pattern would.
- **Mask at every egress, not at one.** Display, logging, storage, and
  telemetry are four doors; a value masked on screen but stored raw is a
  disclosure with a delay timer. Each egress calls the same masking pass —
  one implementation, many call sites, mirrored across runtimes per
  [cross-language-rule-parity](cross-language-rule-parity.md).
- **Replacement preserves accountability.** The mask token says *that*
  something was redacted and ideally *what kind* — a reader diagnosing a run
  needs to know a token was there; they must simply never learn its value.
- **Precision is a survival property.** A default-on masking pass that
  mangles legitimate identifiers — unique ids, content hashes, revision
  digests, which share the shape of key material — corrupts the very
  transcripts people debug with, and the organism responds by reaching for
  the kill switch. Tune entropy heuristics to *exclude* known identifier
  shapes explicitly; a masker biased toward precision keeps running, and a
  running conservative masker beats a disabled thorough one. (The heuristic
  tells: pure-hex runs are identifiers; real key material mixes character
  classes.)
- **Egress inventory is per audience.** Masking at persistence and at
  forwarding is non-negotiable — stored copies outlive their context and feed
  surfaces nobody enumerated. A live view showing an author their *own*
  just-produced output is a different audience than a database read by every
  future feature; it is legitimate to scrub the stored and forwarded copies
  while the owner's live stream stays verbatim, provided the split is a
  named decision, not an accident of plumbing.

## Markup neutralization — and the round-trip trap

Model output rendered into rich surfaces is the classic stored-injection
vector: a summary that includes a script fragment, an attribute that smuggles
an event handler. The neutralization rules that survive contact:

- **Allowlist, not blocklist.** Enumerate what the surface may render — the
  handful of benign tags and attributes the feature needs — and strip
  everything else. Blocklists lose to the grammar's dark corners forever.
- **The entity round-trip.** Encoded forms are the standard evasion: markup
  arrives as entities, passes a naive strip (which sees no tags), and is
  *decoded back into live markup* by a later pass — a template step, a second
  renderer, an export. The gate must be idempotent under decoding: strip,
  decode, and strip again until a fixpoint, or normalize encodings first.
  Sanitization that is not stable under the sink's own decoding is theater.
- **Sanitize nearest the sink.** Neutralize where the surface's grammar is
  known — at render for display, at write for storage feeding many renderers.
  Sanitizing "somewhere upstream" leaves every new downstream surface to
  remember the rule.

## Link schemes and paths — small grammars, sharp teeth

Two output shapes deserve named rules because their exploitation is one
click or one file-open away:

- **Links: allowlist schemes.** A link in model output is rendered as
  clickable by helpful surfaces, and scheme grammars include members that
  execute code or exfiltrate on activation. The rule is an allowlist of
  boring schemes (secure web transport; nothing script-like, nothing
  data-embedding, nothing protocol-handler-shaped), applied to every
  model-authored link before it becomes clickable — and applied to the
  *parsed* scheme, not a prefix string match that whitespace or encoding
  tricks slip past.
- **Paths: resolve, then contain.** Any model-suggested file path is resolved
  to canonical form *first* — traversal segments collapsed, links followed,
  encodings normalized — and then checked for containment inside the
  directory it is permitted to touch. Checking the raw string for
  traversal-looking substrings is the amateur version; the canonical-resolve-
  then-prefix-check is the one that holds. Reject on failure; never "fix up"
  a path that walked out of bounds.

## The sanitizer itself is load-bearing

Two meta-rules keep the pass honest:

- **Failure closes the door**
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)): a
  masking pass that throws, a rule set that failed to load, a neutralizer
  meeting input it cannot process — each yields *no output released*, never
  "released unsanitized with a warning." A sanitizer that fails open is an
  attacker's feature request.
- **One door per sink class**
  ([one-validation-door](../../_laws.md#one-validation-door)): each sink
  family — display, log, store — has one named sanitization entry point that
  all writers use. The audit "which model output reaches this surface
  unsanitized?" must be answerable by enumerating call sites of one function,
  not by reading every feature.

Test the pass with hostile *fixtures*, not hopeful ones: known technique
classes (encoded markup, nested entities, scheme obfuscation, traversal
variants, secret-shape corpora) as named test vectors that both sides of
every language boundary run — the corpus that
[cross-language-rule-parity](cross-language-rule-parity.md) keeps in sync.
