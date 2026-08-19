---
layer: technique
subject: terminal-multiplexing
technique: pty-management
status: forged
laws: [failure-not-empty-success, creation-names-reaper]
shared_with: []
---

# Pseudo-terminal management

The pseudo-terminal is the kernel-level impersonation of a human at a
keyboard: a device pair where the host holds one end and the child's
standard streams are wired to the other, with the kernel providing line
discipline, window-size bookkeeping, and control-code semantics in between.
It is what makes interactive programs behave interactively — prompt, color,
repaint — instead of detecting a pipe and going silent or line-buffered.
This technique owns the device: its creation, the portability seam over it,
resize propagation through it, and exit detection at it.

## One seam, one contract, everything above is platform-blind

Pseudo-terminals are among the least portable primitives a desktop host
touches. The two dominant platform lineages differ not in spelling but in
semantics:

- **Creation and wiring.** One lineage allocates a device pair and lets the
  host wire the child to the replica end directly; the other brokers a
  pseudo-console object through its console subsystem, with the host
  speaking to it over a pipe pair it must create itself.
- **Resize.** One delivers window-size changes with an out-of-band signal
  to the foreground process group; the other communicates size through the
  console object with no signal — a child that waits for the signal waits
  forever.
- **Interrupt.** One turns the interrupt control code into a signal in the
  kernel's line discipline; the other synthesizes a console event with its
  own delivery rules. "Send the interrupt character" is therefore not one
  operation but two different promises.
- **Exit and close.** Which side observes end-of-file when the child dies,
  whether the device end must be drained before close, and whether closing
  the host's end tears down the child differ — and each lineage has its
  own deadlock shape when the order is wrong.

The technique's structural rule: **exactly one module owns this split.** It
exports a small platform-neutral contract — spawn with an initial size,
write bytes, resize, watch for exit, kill — and everything above it,
including the multiplexer, is platform-blind. The seam earns its keep at
review time: a platform quirk fixed inside the seam is fixed for every
session type, while a codebase with platform conditionals sprinkled at call
sites re-fixes each quirk once per caller, minus the caller added next
quarter.

## Spawn wiring: the size is part of the birth

A pseudo-terminal child must be born with a window size. Programs read the
terminal size once at startup to decide layout, and a child spawned at a
default size then resized immediately does a full relayout in its first
hundred milliseconds — visible as a flash of wrongly wrapped output at the
top of every session. The attach-time size (or a sensible roster default
for sessions born detached) travels **into** the spawn call, not after it.

The rest of the child's birth certificate — argument vector, environment,
working directory, the one-spawn-door discipline — is
[subprocess-lifecycle](../../subprocess-lifecycle/subprocess-lifecycle.md)'s
spawn-contract, and this technique inherits it rather than duplicating it.
One terminal-specific addition: the environment must tell the truth about
what it is. Declaring the terminal type and capabilities the emulator
actually implements is a correctness input — overclaiming makes children
emit sequences the emulator renders as garbage; underclaiming loses color
and mouse support that the product paid an emulator to provide.

## Resize propagation is a chain with an owner at every link

Size flows one direction: layout gives the widget a box → the emulator
derives columns and rows from box and cell metrics → the device is told the
new size → the kernel or console object informs the child → the child
repaints → the output flows back up through the ring to the emulator. Every
link has an owner, and the two classic defects are both broken links:

- **Emulator resized, device not told.** The child keeps wrapping to the old
  width; output looks shredded. Users blame the child.
- **Device told, emulator not resized.** The child repaints for a size the
  grid does not have; full-screen programs draw outside the visible area.

Because the chain ends in a child repaint, it composes with
renderer-economics' coalescing rule: the chain is driven at settled-size
cadence, and only for attached sessions — a detached session's chain is
re-run once, at promotion.

## Exit detection: the device lies about halves

A pseudo-terminal child can half-die: the process exits but a grandchild it
spawned still holds the device end open, so no end-of-file arrives; or
end-of-file arrives while the process technically lingers. Watching only
the stream therefore conflates three distinct facts — *the process
exited*, *the device drained*, and *output ended* — and the technique
requires observing the first directly (a process-level wait, owned by
subprocess-lifecycle's reaping) while treating stream end as corroboration,
not verdict.

The session's terminal state must distinguish exit outcomes from silence
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)): "no
output for a while" and "exited with a failure code" are different rungs
with different obligations, and a multiplexer that shows both as a quiet
prompt teaches users to poke dead sessions. On confirmed exit, this
technique's duties are local and bounded — final-drain the device so the
last burst of output reaches the ring, release the device pair
([creation-names-reaper](../../_laws.md#creation-names-reaper): the device
ends are kernel handles, and each side names who closes it and in what
order relative to the drain), and hand the corpse to the process layer for
reaping and outcome recording.
