---
subject: software-engineering/settings
project: personas
raised_by: intake intake-chatterino2 (design read, direction pass)
source: librarian/sources/2026-09-03-chatterino2.md
stage: boot - `src-tauri/db/src/backup.rs` (the pre-migration snapshot, three rotating sets), `src-tauri/db/src/damage.rs` (the quarantine that stops rotation), and the boot-failure path in `src-tauri/src/boot/mod.rs` where a failed `init_db` currently has nowhere to send the operator
size: 4 files / ~250 lines / S-M
status: proposed
---

## Why the scope implies it

`scope.does` says *"local-first storage, one operator per install"*. The tree draws the
consequence itself, at the top of the damage module: *"`personas.db` is local-first:
there is no server-side replica, so the file on the operator's machine is the only
copy"* (`src-tauri/db/src/damage.rs:3-5`). Everything that protects that one copy is
already built and was accepted this week under `store-damage-policy`: a snapshot of the
store plus its WAL and SHM siblings is taken before every boot of an existing database
(`backup.rs:47-60`), three sets survive rotation (`backup.rs:27`), canonical damage
quarantines the store and stops rotation so a damaged file cannot eat its own history
(`damage.rs:22-28`).

What the tree does not have is the half that turns a backup into a recovery, and it says
so in its own words. A migration that meets DDL it cannot rewrite logs and continues
rather than aborting, because an abort *"would strand the user with an app that will not
start and no in-product restore path"* (`src-tauri/db/src/migrations/incremental/support.rs:227-230`).
That sentence is a design decision made under a constraint the design could remove. The
backup module's own recovery story is *"copying the newest backup back over
`personas.db`"* (`backup.rs:9-10`) - a file operation the operator performs by hand, in a
directory the product never shows them, choosing among three files whose state they
cannot inspect.

The source that raised this is a desktop client with the same forces - local-first, one
operator, no server copy - and its answer is a generic "load, else list the backups with
their state, else ask" helper reused for two files, wired to a menu item, with rotation
at nine slots. The registry technique this run landed, `config-backup-and-restore`,
states the rule the two trees share: **a backup that the product cannot offer back is
disk usage, not recovery.** personas has the harder half (classification by extended
result code, quarantine, rotation that knows when to stop) and lacks the easier one.

## What the first context contains

**A restore surface, in two places, over the backups that already exist.** No new backup
policy, no new rotation, no change to when snapshots are taken.

**The boot half.** When `init_db` fails on canonical damage, or a migration aborts, boot
today has no branch that reaches the operator with a choice. The first context adds one:
a boot-failure state that the frontend renders as a restore dialog listing every backup
set under `<data_dir>/backups/` with its timestamp, its size, and its *state* - readable
or not, measured by opening it read-only and running `PRAGMA quick_check` (the same
integrity probe `damage.rs` already trusts for classification). Choosing a set copies it
over the live store, with its sidecars, and reboots the pool; declining leaves the
quarantined file exactly as `damage.rs` left it. The copy is the one `backup.rs:9-10`
already describes; the dialog is the difference between a documented procedure and a
product.

**The settings half.** A "Backups" row in the settings surface that lists the same sets
with the same state column and offers the same restore, so an operator who *suspects*
damage - a run that vanished, a persona that will not load - can act before the next
boot decides for them. This is the surface the source tree wires to a menu item; here it
belongs beside the data-portability export that already lives in settings.

**The guard that keeps it honest.** A test that damages a copy of a real store (the
fixture `canonical_damage_quarantines_and_stops_every_write` at `damage.rs:552` already
makes one), boots against it, and asserts the boot reaches the restore state with the
pre-damage backup listed as readable. Without this test the dialog is a screen that has
never been shown.

**What it must NOT absorb.** Not automatic restore: a restore discards every write since
the snapshot, and that is the operator's decision, never boot's. Not damage
classification, which stays in `damage.rs` and is already right. Not rotation depth or
timing, which `store-damage-policy` owns; if three sets turn out to be too few once
restore is visible, that is a later, separate proposal with a number behind it. Not the
zustand-persisted UI preferences in local storage - those are derivable, and a lost theme
is not a lost run. Not a cloud copy: `scope.does_not` excludes a hosted service, and a
restore surface over local files is the whole of what local-first admits.

## The measurable

**Boots that end with no path forward: today every canonical-damage boot, target zero.**
Today a quarantined store boots read-only and the operator learns the recovery procedure
from a doc comment. After, the same boot ends in a choice. The paired test above is the
assertion; the count of quarantine boots that reached the restore state is the number,
and it is readable from the boot log the moment the state exists.

**Time from damage to a running store**, measured on the fixture: today unmeasurable
(the procedure is manual); after, one dialog. This is the number an operator feels.

**A control.** A healthy store must never see the dialog. The test's second arm boots
the undamaged fixture and asserts the restore state is not reached.

## What would make this wrong

**If the operator population is one person who can copy a file.** The fleet has one
owner and one machine, and that owner can already do what `backup.rs:9-10` describes.
If that stays true, the settings half is a convenience and the boot half is the only
part worth building; the proposal should shrink to the boot dialog and the test.

**If quarantine is judged sufficient.** `damage.rs` deliberately keeps a damaged store
readable so nothing is lost before a person looks. If the position is that a read-only
store plus a support conversation is the product's recovery path, then this direction
is declined and the doc comment at `support.rs:230` should stop calling the absence a
problem.

**If restore-by-copy is unsafe while a pool is open.** `backup.rs:43-46` is explicit
that the snapshot is consistent only because no handle is open at that moment. A restore
has the same precondition. If the boot sequence cannot guarantee the pool is closed at
the point the dialog returns, the first context must restore *on the next boot* (write
the chosen set's path to a marker and let `backup_before_migrations` perform the copy
before any connection opens) rather than in place. That is a smaller design than the
dialog implies and probably the right one; discovering it during implementation is
expected.

**If the state column lies.** `quick_check` on a file with damaged free-list pages can
pass while `integrity_check` fails. The column must say which probe it ran, and a set
marked readable that fails to boot must surface as a second failure, not as a loop back
into the same dialog with the same list.
