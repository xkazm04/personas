---
layer: technique
subject: pipeline-dag
technique: graph-validation
status: forged
laws:
  - one-validation-door
  - failure-not-empty-success
shared_with: []
---

# Graph validation

A pipeline definition is a document the user authored, which means it arrives
with every defect a document can carry: cycles, nodes no path reaches, edges
whose endpoints do not exist, conditions that reference fields no upstream
node produces. All of these are statically detectable — they are properties
of the document, requiring no execution to observe. The technique is to
detect **all of them at the door**, so that by the time a run exists, the
graph it pins is known-good and the executor can be simple.

## The schema comes first

Validation presupposes a defined shape. A graph is: a set of **nodes**, each
with a stable id (minted at creation, never positional), a declared type
(which node class executes it), and a typed configuration; and a set of
**edges**, each `(from-id, to-id)` with an optional condition. Entry nodes
are the ones with no incoming edges — derived from the topology, not flagged
by hand, because a hand-maintained "is entry" flag is a second copy of the
edge set and will drift from it. Everything downstream of this schema —
validation, execution, rendering, diffing — reads the same two collections.

## The check catalog

Run in this order; each check assumes the previous ones passed.

1. **Referential integrity.** Every edge endpoint names an existing node; no
   duplicate node ids; every node's type is a registered class and its
   configuration parses against that class's declared shape. A dangling edge
   is not a warning — an executor that "skips" it has invented semantics for
   a defect.
2. **Acyclicity, proven by construction.** Attempt a topological ordering.
   Success yields the ordering itself — which the executor can reuse as a
   dispatch-order skeleton — so the proof of validity and the execution plan
   are the same computation, and cannot disagree. Failure yields the residue:
   the nodes that could never be ordered *are* the cycle's membership. Report
   them by name. "Graph contains a cycle" is diagnosis withheld; the user
   drew fifty edges and needs to know which three form the loop.
3. **Reachability.** Walk forward from the entry nodes. Anything unvisited is
   unreachable: it will never run, on any input, under any branch. This is
   almost always an editing accident (a deleted edge orphaned a subtree), and
   the one wrong response is silence — a node the user drew and the engine
   will never execute is a disagreement between user and system that must
   surface before run time, not be discovered weeks later as "step never
   fires".
4. **Degenerate-graph honesty.** Zero nodes, or zero entry nodes (every node
   has a predecessor — in an acyclic graph this means zero nodes, but check
   it independently anyway), is rejected, not vacuously succeeded. A run over
   an empty graph that reports "completed" is empty success wearing a green
   badge ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
5. **Condition well-formedness.** Every edge condition parses in the
   predicate language and every operator is known. Whether the *referenced
   data* will exist is partly a run-time question — but the syntax and
   vocabulary are not, and rejecting a malformed predicate at authoring time
   converts a mid-run mystery into a red squiggle.
6. **Class-specific configuration checks.** Each node class contributes its
   own static validation — a gate node has a resolvable approver policy, an
   external node's endpoint is well-formed and inside the allowed egress
   policy (see [external-adapter-nodes](external-adapter-nodes.md)). The
   graph validator is the aggregation point; classes plug checks in, so
   adding a node class cannot silently add an unvalidated configuration.

## One door, enumerated writers

The validation runs as **one function over the whole document**, and every
path by which a graph can come to exist — the visual editor, an import from
a foreign format, a template instantiation, a programmatic API — passes
through it before persisting ([one-validation-door](../../_laws.md#one-validation-door)).
The alternative, validating in the editor only, holds exactly until the
second writer appears; imports are where malformed graphs actually come from,
because a foreign format's semantics never quite map. The run-start path
calls the same door once more as a belt-and-suspenders re-check: cheap,
and it converts "someone wrote to the store around the door" from a silent
corruption into a refused run with a named defect.

## Authoring-time versus run-time — the honest split

Not everything is static. Whether a condition's referenced field will hold a
comparable value depends on what the upstream node actually produces; whether
an external endpoint will accept the call is unknowable until called. The
discipline is to draw the line *explicitly*: everything provable from the
document is proven at the door; everything else is named as a run-time check
with a defined failure semantic (an unevaluable condition is an evaluation
error, not false; an external refusal is a node failure with the response
recorded). What must never exist is the middle category — checks that could
have run at the door but instead ambush the user mid-run, after half the
side effects have happened.

## Decision rules

- Report **all** validation failures in one pass, not first-failure-only: the
  user fixing a graph needs the full defect list, and the checks are cheap.
- Name the defect's members: cycle participants, orphaned node ids, the edge
  with the missing endpoint. Every message should let the user click to the
  problem.
- Validate the document, not the drawing: layout coordinates, labels, and
  colors are presentation and get no vote in validity.
- When the graph mutates only through versioned saves, validate the version
  being saved; a "draft may be invalid, run must be valid" split is fine as
  long as the run-eligible state is unreachable without passing the door.
