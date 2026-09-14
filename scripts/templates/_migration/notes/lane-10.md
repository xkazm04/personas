# Notes - lane-10

Customer support, plus data and AI (11 recipes)

Append below. Newest last. See ../FIELD_GUIDE.md section 6 for the format.

## 09:24 - DECISION - drop binding-shaped knobs out of input_schema
- `scaffold` copies `inputSchema` verbatim, and several drafts carry knobs whose default IS a
  binding: `digest_channel: "#engineering-alerts"`, `eng_manager_email`, `archive_directory:
  "data/weekly_reports"`, `lead_user_id`. The two-layer table says a recipe never carries a
  channel, a credential, an address or a file path, so I am deleting those entries and keeping
  only the knobs that are genuine judgment (a threshold, a cap, a confidence floor).
- Suggest everyone do the same, or the corpus will be half-and-half on the one field where a
  leaked binding is invisible.

## 09:25 - TRAP - draft `id` values are not unique and are not uuids
- The spec calls `id` a stable uuid, but the drafts carry things like `uc_daily_digest`, and
  two recipes in my lane (support-issue-disposition-account, support-escalation-pattern-review)
  carry that same string. The gate does not check id uniqueness, so this will pass and land.
- I left them exactly as scaffolded rather than inventing uuids. Worth the director knowing
  before the index is built, since an index keyed on id would collapse them.

## 09:26 - PATTERN - "recording a zero" is a success_criterion, not a guidance sentence
- Field guide 3b's "recording a zero is the work" reads flabby in `guidance` and sharp as a
  criterion. The shape that worked three times: "A pass that found no new pattern says so,
  rather than promoting the largest category of an ordinary period." Name the specific thing
  the recipe would otherwise pad with, not "reports nothing found".
- Same trick for the baseline lesson: "The first account says it is establishing a baseline
  rather than reporting a change against nothing."

## 10:12 - PATTERN - "a rate of zero is a defect" is the sharpest abstention criterion
- Selective-prediction work on text-to-SQL puts the best calibrated ensemble at answering
  about 27% of questions at 24% selective risk, and finds the model's own certainty is a
  weak signal (self-consistency AUROC ~0.675, verifiers collapsing to ~0.66 on unseen
  schemas). The usable form of that in a recipe is not a number, it is a criterion:
  "A refusal rate of zero is read as a defect rather than as success, because every real
  schema holds questions this work cannot answer honestly."
- Reusable anywhere a recipe lets an agent decline: an escalation bar, a confidence
  threshold, an auto-close. The companion is "confidence rests on something checkable
  rather than on how certain the answer sounds", which retires a whole family of drafts
  that expose a `confidence_threshold` knob and never say what confidence is made of.

## 10:14 - RESEARCH - error analysis from real traffic, for anyone with an "is it any good" recipe
- Hamel Husain's named method is the one practitioners actually use and it beats a golden
  set by construction: sample real traces, **open coding** (free-text notes, at least ~30
  annotated by a human before letting a model cluster), **axial coding** (group into a
  failure taxonomy, the step he calls the most important), count frequency, then one
  **binary** evaluator per important mode. ~100 diverse traces is the working sample; stop
  at theoretical saturation, when new traces stop producing new modes.
- Two hard rules worth stealing: judges are validated against held-out human labels on TPR
  and TNR, not trusted; and generic similarity metrics (ROUGE, BERTScore) "create false
  confidence" as quality measures and are only usable as sampling signals.
- Also: measure a fix by the error rate of THAT taxonomy category before and after, not by
  an overall score. Most RAG failures originate in retrieval, so splitting retrieval from
  generation from data before fixing anything is the first cut.

## 10:16 - RESEARCH - "which of two contradicting documents is current" has a real answer
- The line worth carrying: "last edited 90 days ago tells you a doc is old, not wrong."
  Recency is a weak currency signal because a typo bump beats an untouched stale policy,
  and because drift starts upstream (chat, tickets, commits) rather than in the wiki.
- Signals that actually rank, in rough order: an explicit canonical designation; a
  last-REVIEWED date kept separate from last-modified, with an expiry; a declared owner
  who is still there and still in that domain; version or effective dates and supersession
  markers; backlinks and usage. Useful to any lane with a knowledge-base, policy, or
  documentation recipe, not just mine.
- The structural trap, for anyone doing duplicate detection: a naturally phrased
  contradiction ("X is A" then "X is B") is near-identical text, so a similarity/dedupe
  gate rejects exactly the pairs a contradiction detector was meant to adjudicate. They
  have to be different gates at different times, not one similarity threshold.

## 10:41 - RESEARCH - vendor docs are the best WebFetch target now that search is gone
- With the search budget out, one fetch of a provider's own reference page was worth more than
  the searches it replaced. Stripe's automated-retries page gave the mechanic that rewrote my
  last recipe: on a hard decline the provider keeps SCHEDULING retries and the attempt counter
  keeps incrementing while nothing actually executes, so a watcher reading the counter sees
  recovery in progress on precisely the accounts where recovery has stopped.
- The transferable shape, and it is not Stripe-specific: **a progress counter maintained by
  somebody else is not evidence that anybody is progressing.** Anyone with a recipe that reads
  a retry count, a queue depth, an attempt number or an "in progress" state from an external
  system can use that directly.
- Vendor reference docs fetch cleanly (no 403s, and they render to markdown well). Named API
  and behaviour pages beat marketing pages by a lot.

## 10:44 - PATTERN - the honest upgrade to a "queue it for a human" recipe is EVIDENCE, not a better queue
- Two of my drafts ended at "hand every finding to a person, never decide alone". That is
  correct and it is also a punt: it hands over the expensive half of the work. The rewrite that
  made both recipes worth adopting was to ask what the person has to go and find, and make
  gathering that the recipe's job. For a contradiction pair: the disagreeing sentences quoted
  from both sides, plus whatever each side records about its own currency, plus an explicit
  statement when neither records anything.
- Generalizes to any recipe whose deliverable is a human decision. "Queued for review" is a
  handoff; "queued with the evidence the decision turns on" is the craft. And the third
  criterion is the one that keeps it honest: say when the evidence does not exist, rather than
  substituting the weakest available proxy.

## 10:46 - DECISION - reshape a knob when research says its QUANTITY is wrong, not just its wording
- Extending lane-04's note with two concrete cases, because both were quantities that looked
  reasonable and decided the wrong thing:
  `warning_window_minutes: 15` on an SLA watch became `warning_at_percent_of_budget: 80`. A
  fixed lead time is generous against a five day promise and useless against a one hour one;
  a share of the budget is the same judgment at every scale.
  `contradiction_title_distance: 5` (a Levenshtein cap) was deleted outright. Title-string
  similarity is not subject similarity, and a plainly stated contradiction is near-identical
  text, so tightening that knob discards exactly the pairs the recipe is hunting. It was
  replaced by two knobs that are real adoption decisions: how many pairs may reach a reader,
  and how much of the corpus one pass compares.
