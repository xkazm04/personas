---
layer: technique
subject: form
technique: server-error-mapping
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Server error mapping

Client validation is a courtesy; the system of record is the authority, and
it will reject submissions the client considered green — uniqueness collided,
state moved underneath the draft, an invariant the client never knew about,
permissions changed. A form is not finished when it validates; it is finished
when it can **receive any rejection the server produces and land it where the
user can act on it**. Forms built without this path render their most
important failures as their worst screens: a raw code in a toast, a generic
"something went wrong" over a perfectly repairable draft, or — worst —
nothing.

## The mapping ladder

Every rejection walks the same ladder, stopping at the first rung that fits:

1. **Field-attributable** → render as a field error, exactly as if client
   validation had caught it: same slot, same styling, same association and
   announcement wiring, and focus moves to the field. The user cannot tell —
   and must not need to tell — which layer caught the problem. This requires
   a **translation table** from the server's vocabulary (constraint names,
   error codes, field identifiers in the server's naming) to the form's
   field identities and user-facing language. The server's field names are
   not the form's field names — casing, nesting, and structure all differ —
   and the table is where that seam is owned, once.
2. **Form-attributable** (the combination is invalid, the record was
   modified by someone else, the draft conflicts with current state) → the
   form-level error slot, with the *action* the situation calls for: reload
   and re-apply, override knowingly, or abandon. A conflict rendered as a
   bare "conflict" without a next step is a dead end with good intentions.
3. **Unmappable** → the honest fallback: a form-level error stating the
   submission failed, preserving the draft, offering retry, and carrying
   enough correlation (a reference the user can quote) for support to find
   the real cause. **Unmappable must still be loud.** A rejection whose code
   matches no table entry and therefore renders nothing is a failure dressed
   as success — the user watches a busy button relax and assumes commit
   ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

The ladder is a single function through which the submit path routes *every*
rejection. Call sites that hand-inspect responses each invent their own rung
ordering, and the one that forgets rung 3 ships the silent failure.

## The translation table is a contract under drift

The table maps a vocabulary the client does not own. Consequences:

- **Unknown entries are expected, not exceptional.** The server will grow new
  rejection codes after the client shipped; rung 3 is the designed home for
  them, and a metric or log on rung-3 hits is the feedback loop that tells
  the client team the table needs entries.
- **The server's message text is input, not output.** Raw server messages
  leak schema names, internal vocabulary, and occasionally other users' data
  into the UI; the table maps codes to the product's own language. Where the
  server's message *is* the best available detail (a validation service with
  rich prose), it is displayed as detail under a mapped headline, never as
  the headline itself.
- **One authority for the rejection vocabulary** — the server's contract
  defines the codes; the client's table derives from it and says so
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
  Two clients each hand-curating their own interpretation of the same codes
  will disagree in front of users.

## Special rejections worth designing for

- **Uniqueness collision** on a value an async availability check blessed
  moments ago: the race is inherent (someone else committed in between), so
  the field-level message should read as *news* ("just taken"), not as a
  contradiction of the earlier checkmark.
- **Stale-record conflict**: the draft was edited from a snapshot that has
  since changed. The repair options are real design work — show what changed,
  offer merge or overwrite — but the minimum bar is preserving the user's
  draft while they decide. Silently overwriting either side is choosing a
  loser without telling them.
- **Authorization changes mid-draft**: the user could open the form but the
  commit was denied. Attribute to the form, say what permission is missing,
  and do not bounce them out of the surface — the draft may be salvageable
  by someone else or after a re-login.
- **Partial success** (a batch form where some rows committed): the most
  dangerous shape, because both "all good" and "all failed" renderings lie.
  Report per-item outcomes, keep the failed subset editable, and never
  re-submit the succeeded subset on retry.

## Prohibitions

1. No raw server message as a user-facing headline.
2. No rejection without a rendering — unmapped codes take rung 3, loudly.
3. No field-attributable rejection rendered only as a toast or form banner
   while the field sits unmarked.
4. No mapping logic duplicated per call site — one ladder, one table.
5. No rejection path that discards the draft.
6. No partial success rendered as total success or total failure.
