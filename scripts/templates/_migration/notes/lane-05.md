# Notes - lane-05

Sales and marketing: lead handling and community channels (6 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.

## 09:1x - GATE - check-recipes.mjs is repo-wide, so it cannot be green until all ten lanes finish
- The gate walks every recipe directory in the registry, including the half-written
  scaffolds the other nine lanes have on disk right now. A `FAILED` line is the normal
  state mid-migration and says nothing about your work.
- Verify your own recipe by ABSENCE: grep the output for your slug. If it appears in
  neither the `problem(s)` list nor the `note:` lines, yours is clean. `scaffold` leaves
  `use_cases: []`, which is exactly the failure everybody else's in-flight recipes show.

## 09:1x - RESEARCH - the lead response time numbers, and how much weight they hold
- The canonical finding: leads contacted within 5 minutes are ~21x more likely to qualify
  than at 30 minutes, and contact odds fall ~100x over the same gap (MIT / InsideSales
  2007, ~15k leads; repopularised by HBR 2011). It is one dataset and it is correlational,
  so state the SHAPE (decay measured in minutes, not hours) and do not put the multiplier
  in a recipe as if it were a law.
- The far more useful counterpart: Drift secret-shopped 433 B2B companies and 7% replied
  inside 5 minutes while 55% never replied within 5 business days; a later InsideSales
  pass over 55M activities found 0.1% engaged inside 5 minutes. So the gap between the
  known best practice and reality is enormous, which is what makes the recipe worth
  adopting rather than obvious.
- Useful anywhere a recipe trades on freshness: alerting, first-touch outreach, incident
  notification, support first response.

## 09:1x - PATTERN - a success criterion that makes "found nothing" a result
- The App Master lesson "recording a zero is the work" turns into a checkable criterion
  if you write it as a distinguishability claim rather than as a reporting instruction:
  "A period in which nothing crossed the threshold is reported as a quiet period, so
  nobody has to guess whether the pipeline was empty or the alerter was broken."
- The same shape covers "in flight needs an observable end": "An alert that fired and was
  never picked up is visible as unpicked, rather than indistinguishable from one that was
  acted on." Both read as claims about the world, which is what an outcome has to be.

## 09:5x - DECISION - extending lane-10's binding-knob rule: also drop knobs whose NAME leaks a connector
- Adopted lane-10's "delete binding-shaped knobs" and hit a second shape it does not cover:
  a knob whose *name* carries a connector's private vocabulary. `subreddits` and
  `posts_per_subreddit` in a recipe that declares `social` are the same leak as
  `digest_channel`, just harder to see. Renamed to `sources` and `items_per_source`.
- Third case, and the more common one: the quantity is legitimate but the description is
  not. `max_clusters` and `time_window` stay; their descriptions were rewritten into the
  judgment the research produced ("a ceiling, never a target"; "derive it from the trigger,
  because a window and a cadence are the same fact stated twice"). Deleting those would
  have thrown away a real adoption decision. Delete a binding, rewrite a quantity.

## 09:5x - DECISION - `transformNotes` should not travel into the registry once you have acted on it
- Two of my drafts carry a `transformNotes` array addressed to the migrator: "carries
  cadence, reported not changed", "safe to rewrite in Phase D". The moment you act on one,
  the note is false, and a shipped registry artifact carrying a stale instruction to itself
  is exactly the rendered-surface-with-no-coupling problem the lane doc warns about.
- The gate ignores unknown fields, so it will silently ship if you leave it. Act on the
  notes, then drop the array. Do not drop it without acting.

## 09:5x - PATTERN - the same connector in two recipes needs two DIFFERENT examples files
- Slack is the delivery binding in two of my recipes and the mapping knowledge is close to
  opposite. For a lead alert: post at channel level, never into a thread, because a thread
  reply is invisible and the failure looks like a successful delivery. For a digest: put
  headlines in the message and detail in the thread, because the surface collapses long
  messages and above the fold IS the digest.
- Useful test, and it is the field guide's own test made concrete: if you could paste your
  examples/<connector>.md into another recipe unchanged, you have written a connector
  datasheet rather than a mapping. Ask what THIS recipe needs from the connector that a
  different recipe would not.

## 09:5x - RESEARCH - the legal floor under any recipe that sends outbound mail
- A reply to an enquiry somebody made and a marketing message to a contact are different
  objects in law, and the boundary is crossed by content rather than by intent: the moment
  the reply carries promotion beyond answering the question, identification, physical
  address and working-unsubscribe obligations attach. Under CAN-SPAM the primary purpose
  test decides it, opt-outs must be honoured within 10 business days, and each violating
  message carries a penalty of up to about $53,000 (FTC compliance guide, 2024 adjustment).
  Consent-regime jurisdictions are stricter still and some grant only a time-limited
  implied consent from an enquiry.
- The useful move for a recipe is NOT to encode any of that. It is to make the adopter own
  it explicitly, as a `personalization_needs` entry: which jurisdictions their enquirers
  are in, and whether the reply is meant to stay a reply or is allowed to market. A recipe
  that says nothing looks as though it has decided, which is the failure.

## 10:2x - PATTERN - absence has three states, not two, and most drafts only have two
- The strongest single correction I made all lane. A draft said "distinguish a source that
  is quiet from a source that is broken". There are three: the fetch errored (a credential,
  a rename, a rate limit, and it is fixable today), the fetch worked and returned nothing
  usable (a curation question, fixable in a month), and the thing is genuinely too new to
  have a normal yet. Collapsing them produces a recommendation that mixes "fix this token"
  with "stop following this forum", and the reader trusts neither.
- The companion is a fourth check that no draft in my lane had: rule out a SHARED fault
  before blaming any individual unit. A network outage otherwise recommends deleting the
  whole watch list at once, and every criterion in the recipe fires correctly while doing it.
- Reusable in any recipe that watches a set of things for absence: sources, endpoints,
  feeds, repositories, accounts, suppliers.

## 10:2x - DECISION - an examples[] entry that documents a MISMATCH is worth keeping, and there are more of these
- One of my drafts named Airtable as the `crm` example while Airtable's catalog categories
  are spreadsheet / database / project_management, so an adoption resolving `crm` will never
  be offered it. The instinct is to drop the entry. I kept it and wrote the file as an
  explicit mismatch: which type does resolve, what a base cannot do that a CRM does
  (uniqueness on write, an owner field, merge), and the general rule that a declared type
  resolving to nothing is the quietest possible adoption failure.
- Worth checking your own drafts for the same shape, because the transformation could not
  see the catalog: an `examples[]` entry whose `connector_type` is not actually among that
  connector's catalog categories. It reads as a recommendation and is not one. Keeping it
  and labelling it teaches more than deleting it, and it costs one honest paragraph.
