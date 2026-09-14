# Notes - director

Read this first. Four lanes have finished and arrived at the same small set of rules
independently, which is usually a sign they are real. They are yours to use rather than
re-derive.

## 10:2x - PATTERN - record the correction against the INSTRUMENT, not the item

cp-04 and cp-05 reached this separately in different domains. A reviewer overturning one
finding is not evidence about that finding; it is evidence about the thing that produced
it. So the correction lands on the dial: the severity's cost model, the voice-count
threshold, the scoring category, the stopping rule, the belief the proposal rested on.

This is also what passes the swap test cheaply. Every recipe has a different dial, so a
sentence anchored to the dial cannot be moved to another recipe without becoming false.
A sentence anchored to "the finding" can be moved anywhere, which is how you know it is
padding.

## 10:2x - PATTERN - name what the correction MOVES: the selection, the threshold, or the confidence

cp-01's typology, and it is the fastest way to write part three. The durable record
usually already exists in these recipes, so what is missing is rarely a place to put the
correction. What is missing is the sentence saying what changes because of it.

## 10:2x - PATTERN - the uncorrected half is almost always the SUPPRESSED half

cp-02 and cp-05 both. A reader sees what the digest printed, the alert that fired, the
finding that was raised, and can correct those. They never see what was cut, which is the
call the threshold actually makes. The strongest enrichments in this pass reach the
suppression: the lead that never fired, the theme the voice count dropped, the item held
back by an over-full window.

Where the recipe genuinely never suppresses, that is often a legitimate `no`. cp-05's one
`no` was exactly this: a scan that flags everything into a report the reader already opens
has nothing hidden to be wrong about.

## 10:2x - PATTERN - sometimes the record does not exist yet, and saying so IS the enrichment

cp-05's sharpest finding. The lead-drafting recipe records what was **sent**, so an
approver's edit overwrites the draft and the difference between them is unrecoverable by
construction. The correction passes through the recipe and is destroyed by its own storage
choice. Naming that the draft must survive alongside what went out is the whole finding,
and it is worth more than any sentence about learning from feedback.

Look for this shape: does the recipe overwrite, or does it keep both sides?

## 10:2x - TRAP - a correction that must NOT change the current run

cp-04 on the experiment significance watch. The obvious enrichment, let the next run learn
from an overruled call and call sooner, reintroduces exactly the peeking that recipe exists
to prevent. The fix was to bind the correction forward only: it changes the stopping rule
that later experiments declare, never the horizon of the one in flight.

Check for this wherever a recipe's authority comes from a commitment made in advance: a
fixed horizon, a notice period, a pre-declared playbook, a rung granted before the work.

## 10:2x - DECISION - the noes are not evenly spread, and that is fine

cp-01 one, cp-02 three, cp-04 zero, cp-05 one. Do not calibrate to a target. A lane of
judgment-heavy proposal recipes should have few; a lane of measurement and synchronisation
should have several. Report yours with the reason and move on.

## 10:2x - DECISION - a criterion beats guidance far more often than expected

Twenty-nine of the thirty enrichments so far went into a `success_criteria` entry. Guidance
is 40 to 90 words and most of this corpus sits at 78 to 90, but that is not the main
reason. The correctable call is nearly always owned by one specific outcome, and a
criterion under that outcome is where the next run would actually read it. cp-05 used a
criterion even on a recipe with 23 words of room, on the ground that the worked example is
copied by everyone and guidance would have taught copiers that a correction is a general
remark rather than something attached to an outcome.
