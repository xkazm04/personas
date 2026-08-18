---
layer: technique
subject: audit-logging
technique: write-path-sanitization
status: forged
laws: [one-validation-door]
shared_with: []
---

# Write-path sanitization

The audit ledger is the worst place in the system for a secret to land,
because everything that makes the ledger good at its job makes it good at
preserving a leak: it is durable by contract, retained on a horizon
measured in months, copied into backups and exports, and read by a wider
audience than the operation it records. A secret in a diagnostic log is an
incident; a secret in the audit ledger is an incident **with a retention
policy**. This technique is the discipline that keeps values out: scrub
at the moment of insert, inside the chokepoint, where no caller can
forget.

## Before insert, never after

The scrub happens on the write path — inside the ledger's one door (see
[write-chokepoint](write-chokepoint.md)), after the record is assembled
and before it touches storage. The alternative, scrubbing stored rows
after a leak is noticed, fails three ways at once:

- the append-only contract (rightly) resists in-place edits, so the
  scrub either breaks the trail's integrity claim or doesn't run;
- the interval between insert and scrub is an exposure window during
  which backups, replicas, and exports took copies the scrub will never
  reach;
- discovery is the bottleneck — after-the-fact scrubbing only fires for
  leaks someone noticed, and the ones nobody noticed are retained to
  horizon.

Sanitization-at-insert converts "we clean up leaks" into "leaks do not
enter," which is the only version an auditor — or a breach investigator —
credits.

## References, not values

The strongest scrub is structural: the record's schema carries
**identifiers only** — actor identifiers, credential identifiers, subject
identifiers, action names, outcome codes — and has no field where a
secret value *could* go. A contributor cannot leak through a field that
does not exist. Confirmation-by-identity extends to display: the trail
says "authenticated as X using credential Y," never any portion of the
credential itself; every partial echo (prefixes, masked middles) is a
partial leak and trains readers to expect secret material on audit
surfaces.

## The free-form field is the breach

Most real ledgers keep one flexible field — "details," "payload,"
"context" — because domains legitimately differ in what a record must
carry. That field is where every leak arrives, because it is the one
place the schema doesn't constrain. Three controls, applied together
inside the door:

1. **Allowlist, not denylist, where shape is known.** When the payload's
   legitimate keys are knowable, copy exactly those keys and drop
   everything else. A denylist enumerates yesterday's leaks; an allowlist
   enumerates today's needs, and fails closed for the field added next
   quarter.
2. **Pattern scrubbing where shape is open.** Where genuinely arbitrary
   content must pass (an error message, a request summary), run it
   through the secret-pattern scrubber — known credential formats, bearer
   markers, key-shaped strings — accepting that pattern scrubbing is a
   safety net with holes, which is why it is the second control and not
   the first.
3. **Size caps.** A payload cap (and a per-string cap inside it) bounds
   both the blast radius of whatever the first two controls missed and
   the storage economics of the ledger. Oversize input is truncated with
   an explicit marker — a record that says "truncated" is honest; one
   silently cut is a puzzle for the next investigator.

The same three controls govern **personal data**, which shares the
secret's problem shape (retention turns presence into liability) with an
extra twist: erasure obligations can attach to it, and an append-only
ledger cannot erase. The resolution is the same as for secrets — keep it
out at the door; record identifiers that point at the mutable primary
store rather than copying attributes into the immutable one.

## Scrub failures fail closed, and are visible

When the sanitizer itself errors — a payload that won't parse, a scrubber
exception — the door does not shrug the record through unscrubbed. It
writes the record with the payload replaced by a sanitization-failure
marker, and counts the event on the same surface that counts failed
writes (see
[best-effort-with-accounting](best-effort-with-accounting.md)). Losing
one record's detail is a cost; archiving an unknown payload because the
scrubber crashed is the exact failure the technique exists to prevent.

## Test the door with hostile records

Sanitization is one of the few audit properties that unit-tests
completely, because the door is one function
([one-validation-door](../../_laws.md#one-validation-door) pays off in
the test suite too): feed records carrying planted secrets in every field
and nested position, assert the stored form contains none of them.
This suite is cheap, it pins the allowlist and the patterns against
regression, and its existence is itself evidence — "here is the test
that proves secrets don't enter" is an answer auditors accept.
