---
layer: technique
subject: subprocess-lifecycle
technique: spawn-contract
status: forged
laws: [one-validation-door, gate-sees-target]
shared_with: []
---

# The spawn contract

Everything a child process will believe about the world is fixed at the
moment of spawn: what program runs, with what arguments, seeing what
environment, standing in what directory, holding which stream ends. Each of
those is an input the host *constructs*; treating any of them as ambient —
"whatever the platform defaults to" — hands the child's behavior to whoever
last touched the host's surroundings. The technique is to make all five
explicit, and to make them explicit **in one place**.

## One spawn door

Structurally first, because it carries everything else: the host has **one
constructor** through which every child launch passes — one function that
takes the *intent* (which tool, which inputs, which run identity) and
produces the fully-hardened spawn. This is
[one validation door](../../_laws.md#one-validation-door) applied to process
execution. The alternative — each call site assembling its own spawn —
guarantees that the hardening below is applied `N-1` times out of `N`, where
the missing site is the one added after the security review. The door is
also where cross-cutting obligations attach exactly once: the identity
marker for orphan sweeps, the slot acquisition, the liveness registration,
the kill-on-drop backstop.

## Arguments are a vector, never a string

The child receives an argument **vector**: discrete strings, one per
argument, passed through an interface that never re-parses them. The
string-concatenation path — build a command line, hand it to a shell —
re-introduces an interpreter between the host and the child, and every
metacharacter in every interpolated value becomes live syntax. This is not
only an injection risk from hostile input; it is a correctness bug for
*honest* input: paths with spaces, arguments with quotes, values that look
like flags.

Two hardenings on top of the vector:

- **Positional values that could start with a dash** are preceded by the
  conventional end-of-flags separator, or passed via explicit flag forms, so
  a value is never promoted to an option.
- **Flags come from a closed builder, not free-form pass-through.** The door
  knows which flags the tool accepts and which combinations the host
  intends; a caller cannot smuggle an arbitrary flag through a value field.

## The executable is resolved deliberately

"Run the tool by name" means "run the first thing on the ambient search path
that answers to the name" — and the ambient search path is user-writable,
order-sensitive, and different per machine. The threat is not exotic: a
stray same-named script earlier on the path — installed by another tool, or
planted — silently substitutes itself, and every downstream guarantee is now
about the wrong program. On platforms where script wrappers and binaries
coexist under one name, resolution order can even differ between the host's
lookup and the shell's, so "it works in a terminal" proves nothing.

The discipline: the door **resolves the executable once, deliberately** — an
explicitly configured location first, a vetted resolution against a
*sanitized* search path second — and then spawns by absolute path. The
resolution is logged with the spawn record, so "which binary actually ran"
is answerable after the fact. A gate that intends to run tool X must
observe that it is running tool X
([gate-sees-target](../../_laws.md#gate-sees-target)); path luck is a proxy.

## The environment is constructed, not inherited

Full inheritance is the worst default in the subject. The host's environment
contains secrets (tokens, connection strings), behavior-warping settings
(proxy variables, tool-specific overrides, locale), and platform noise —
and a child that inherits all of it has an ambient capability set nobody
audited. The child's environment is **built from an explicit allowlist**:

- the minimal platform variables the child genuinely needs to function;
- the tool's own configuration, set deliberately;
- credentials injected **individually and on purpose** — each one a decision
  with a name, never "and everything else came along";
- pinned locale/encoding settings, so output parsing upstream does not vary
  by machine.

Everything else is absent. The test of a good child environment is that it
can be printed in a log without redaction anxiety — and if it cannot, the
entries that cause the anxiety should each be traceable to a line of code
that chose to add them.

## The working directory is chosen, never ambient

The child stands where the door places it: typically a **per-run private
scratch directory** the host created and will delete (the directory names
its reaper like everything else), or the specific workspace the operation
targets. Never the host's own current directory — that couples child
behavior to host history — and never a shared scratch location where
concurrent siblings collide (see
[concurrency-and-slots](concurrency-and-slots.md) on disjoint ownership).

## Stream wiring is decided at spawn

The three standard streams are each explicitly wired: captured, discarded,
or fed. The critical negative rule: a child that might prompt interactively
must have its input end **closed or connected to a policy**, never left
attached to a host that will never answer — an inherited idle input is the
classic cause of the alive-but-waiting-forever stall that
[liveness-and-heartbeats](liveness-and-heartbeats.md) then has to detect.
What flows through the captured ends — framing, buffering, rendering — is
the neighboring subject's jurisdiction
([streaming-output](../../streaming-output/streaming-output.md)); this
technique's obligation ends at handing over live pipe ends and honestly
reporting when they close.

## The spawn record

The door emits one structured record per launch: resolved executable,
argument vector, environment *names* (never values), working directory,
run identity, and the ceiling it was admitted under. This record is what
turns "a child misbehaved" from an archaeology project into a lookup — and
it is only trustworthy because the door is the only spawner, so the record
provably describes every child that exists.
