---
layer: technique
subject: observability-telemetry
technique: rotation-and-retention
status: forged
laws: [creation-names-reaper, count-carries-predicate]
shared_with: []
---

# Rotation and retention

A log file is the only artifact in a product that grows every time
anything happens — including, especially, when things go wrong. Left
unbounded it is an outage generator with a fuse: the disk fills on the
machine that was already failing (failures emit volume; volume fills
disks; full disks fail everything else). Rotation and retention are how
the recording subsystem stays a tenant instead of becoming the landlord's
problem. Per
[creation-names-reaper](../../_laws.md#creation-names-reaper), the moment
a record class is created, three questions have answers: how big may one
unit grow, how many units are kept, and what deletes the excess.

## Rotation: bound the unit

Rotation closes the current file and opens a fresh one on a boundary —
by interval (a file per day is the most operator-legible scheme: the
filename *is* the query "what happened Tuesday") or by size (a hard cap
per file, which bounds the worst case under a log storm). Interval
rotation alone has a hole worth naming: a pathological error loop can
grow one interval's file without limit, so mature setups either cap size
within the interval or rely on the retention tier's total-footprint cap
to contain the blast.

Mechanics that matter:

- **Rotation is the writer's job**, behind the non-blocking boundary —
  emitters never notice a rotation happening.
- **Names sort chronologically** and encode the boundary (the date, the
  sequence number), so both humans and the reaper can order the set
  without opening files.
- **The current file has a stable name.** "Tail the active log" is the
  single most common diagnostic act; it must not require guessing
  today's filename.

## Retention: bound the set

Rotation without retention just shatters one unbounded file into an
unbounded set. The retention tier is a **reaper** — a periodic pass that
enforces declared caps by deleting the oldest units. The senior points:

- **Cap by total footprint, not only by age or count.** "Keep 14 days"
  is an unbounded promise if one bad day emits gigabytes; "keep 14 days
  AND at most N megabytes, oldest evicted first" is a bound the disk
  can rely on. Age answers "how far back can I look"; size answers
  "what is the worst case" — operators need both stated.
- **The reaper runs on a schedule and at startup.** Startup matters
  because the machine that crashed from a full disk needs the reaper to
  run *before* the subsystem resumes writing, and because a process
  that only reaps mid-run never reaps on machines that crash early.
- **The reaper reaps only what it owns.** It deletes by the naming
  pattern it recognizes inside the directory it manages — never "clear
  the directory". Diagnostic directories accumulate neighbors (crash
  stores, exported bundles, other subsystems' spools) and a greedy
  reaper is a data-loss defect wearing a janitor's uniform.
- **Reaping is logged, at one line.** "Removed K files, freed M bytes,
  cap N" — so that when someone asks where last month's logs went, the
  answer is on file, and so that a reaper that silently stopped running
  is distinguishable from one with nothing to do
  (the [failure-not-empty-success](../../_laws.md#failure-not-empty-success)
  shape, applied to the janitor).

## Accounting: the footprint is a number someone can see

Retention promises are only auditable if the actual footprint is
measurable on demand: a diagnostic surface that reports the records
directory's current size, file count, and oldest entry. Two disciplines
attach to that number
([count-carries-predicate](../../_laws.md#count-carries-predicate)):

- **State what is counted.** "Diagnostics: 84 MB" spanning logs, crash
  records, and spooled exports is a different claim from "log files:
  84 MB" — the number travels into support conversations and capacity
  decisions, so it carries its predicate.
- **Measure by walking, not by ledger.** The trustworthy figure is
  recomputed from the directory itself, not maintained as a counter
  that drifts from reality the first time anything else touches the
  directory.

## Retention is a policy statement, not just hygiene

What the product retains is a commitment made on the user's disk with
the user's data-adjacent records in it. The caps belong where an
operator can read them — documentation or the diagnostic surface itself,
"we keep at most this much, this long" — because retention interacts
with real obligations: an incident older than the retention window is
undiagnosable by design (a trade-off to make consciously), and a privacy
question ("what does this product remember about my machine?") deserves
an answer more specific than "whatever has not been rotated away yet".
