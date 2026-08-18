---
layer: technique
subject: connector-catalog
technique: shipped-vs-operator-ownership
status: forged
laws: [one-validation-door, gate-sees-target]
shared_with: []
---

# Shipped vs operator ownership

A catalog table has two legitimate writers with opposed lifecycles. The
**vendor** ships rows and must be able to update them after the fact — a
corrected auth schema, a fixed probe endpoint, a new capability has to reach
installs that already exist, or every shipped defect is permanent. The
**operator** edits rows to fit their world — renames, recategorizes, adds a
field for a self-hosted variant — and must be able to trust that edits
survive. Any store with defaults-plus-customization faces this: connector
rows, shipped templates, rule packs, default dashboards. The technique is the
contract that lets both writers win.

## The canonical failure: the boot-time clobber

The naive refresh is an unconditional upsert at startup: for each shipped
entry, overwrite the installed row with the shipped values. It satisfies the
vendor perfectly and silently reverts every operator edit on every launch.
Three properties make this failure a *class* rather than a bug:

- **It is invisible by construction.** The revert happens before anyone looks;
  the operator sees their edit "not take" and blames themselves. If the
  refresh also stamps the row's modification timestamp, it destroys the only
  forensic evidence — the store now testifies that the vendor's values are
  the operator's latest edit.
- **Survival is accidental.** Whichever columns the refresh's hand-maintained
  write list happens to omit are the columns where edits survive. That is not
  a policy; it is a bug that flatters some users. The measured in-repo
  instance of this technique's failure shows exactly this signature: one
  presentation column survived operator edits solely because the rewrite list
  forgot it.
- **It swallows every other writer too.** The operator's edit door is merely
  the writer you thought of. App features that annotate rows (an import flow
  recording discovered capabilities, a usage feature stamping metadata) are
  writers as well, and the clobber reverts them identically. Ownership
  contracts must start by **enumerating the writers**
  ([one-validation-door](../../_laws.md#one-validation-door) — the law's
  enumerable-writers half), because every writer not in the contract is a
  future silent loser.

## The contract: ownership is per column, and the refresh is gated

Two structural decisions replace discipline:

**1. Split the row by owner.** Decide, column by column, who wins:

| Owner | Typical columns | Refresh may write? | Edit door may write? |
|---|---|---|---|
| Vendor | identity, auth schema, probe recipe, capability declarations | yes | ideally no (or fork-on-write) |
| Operator | label overrides, category, enablement, notes, presentation tweaks | never | yes |
| System | provenance stamps, shipped-revision, timestamps | by its own rules | no |

Make the split *structural*, not conventional: hand the refresh a type that
can only name vendor columns, so writing an operator column is unrepresentable
rather than forbidden. A write list that must merely be remembered correct is
the accident-survivor bug waiting to recur in reverse.

**2. Gate the refresh on evidence of change.** The refresh must compare
before writing ([gate-sees-target](../../_laws.md#gate-sees-target) — the
thing gated is "did the shipped definition change and did the operator not
touch this", so that is what the gate must observe):

- Stamp each seeded row with the **shipped revision** (a version or content
  hash of the shipped entry) at seed time.
- On boot, rewrite a row's vendor columns only when the shipped revision
  differs from the stamped one — no-op boots stop touching rows at all, and
  modification timestamps become true again.
- For vendor columns the operator *was* allowed to touch (some contracts
  permit it), detect the edit by comparing the current value against the
  *old shipped* value — the three-way-merge shape: shipped-old vs
  shipped-new vs current. Unedited → take shipped-new. Edited and vendor
  changed → a genuine conflict; surface it (see below), never silently pick.

## Conflicts are rare and must be loud

With per-column ownership, true conflicts occur only where both parties may
write the same column and both did. The honest resolutions, in descending
order of respect for the operator:

1. **Keep the edit, notify** — "a newer shipped definition exists for an
   entry you customized" with a one-click diff and adopt.
2. **Fork-on-write** — an operator edit to a vendor column copies the row
   into operator ownership (a variant referencing its shipped parent);
   refresh updates the parent, the variant keeps a visible "shipped parent
   has moved" marker.
3. **Take shipped, preserve the edit visibly** — acceptable only for
   correctness-critical vendor columns (a broken probe must be fixable), and
   only if the displaced value is retained and surfaced, never dropped.

Silently taking shipped is the clobber again; silently keeping the edit
forever means shipped fixes never land. Either silence is a policy decision
being made by omission.

## Verification is part of the technique

The contract is testable, and the test is cheap: **edit one field of every
ownership class, restart, and diff.** A store passing this test proves the
contract; a store that has never run it is running the naive refresh until
proven otherwise. Two adjacent audits complete the picture: modification
timestamps should show a *spread* (a store where every row shares one
timestamp — the last boot — is confessing to the clobber), and the writers
enumerated in the contract should be checked against the writers that
actually exist in code, because the contract only binds the writers it names.
