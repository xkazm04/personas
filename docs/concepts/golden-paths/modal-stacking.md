# Golden path — Modal stacking and hosting

> Situation node: `ui-system/overlays/modal-stacking` ·
> [situation spine](../situation-spine.md) · recurrence 11 · risk **medium** ·
> sides: **client** · convergence: **mixed** ·
> dimensions: **ui · function · code-quality · resilience** ·
> `twoSided: false` · merged from *"Nested modal stacking"* + *"Multi-modal
> stack"* + *"App-root modal host"*.
> Composed 2026-08-17 against `master` @ `313dc6a84`.
>
> **Sweep size.** 2,083 `.tsx` files walked twice — once through
> `scripts/census/lib/instruments/matchJsxTags` + `stripComments`, once through a
> bespoke brace/quote-balancing tag scanner — yielding **129 `<BaseModal>` render
> sites across 128 files** and **20 hand-painted modal backdrops across 19
> files**. Full reads of `lib/ui/BaseModal.tsx`, `lib/ui/ModalStackContext.tsx`,
> `lib/keyboard/AppKeyboardProvider.tsx`, `App.tsx`,
> `eslint-rules/enforce-base-modal.cjs` and its `RuleTester` fixtures,
> `shared/components/feedback/ConfirmDialog.tsx`,
> `shared/components/modals/index.ts`, `styles/globals.css`, plus every one of
> the 19 hand-rolled overlay files and all 8 `containerClassName` call sites
> opened by hand. `custom/enforce-base-modal` **executed** over its entire
> anchor population (the 16 files containing `role="dialog"`) and its 8 reports
> opened one by one. A five-repo convergence sweep
> (`../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
> `../ascent`) answered six questions about modal hosting per repo.
> `cargo` was not run (unavailable). The full census registry was **not** run,
> per the doctrine's prohibition; only this path's two rules were validated, in a
> private registry.

---

## 0. The headline: the stack registry is the fleet's only one, and it decides Escape for a modal the compositor may be painting underneath

`BaseModal` computes a depth from a real registry and uses it for two different
things:

```
lib/ui/BaseModal.tsx:177-178
  const baseZ = portal ? Z_INDEX_PORTAL_BASE : Z_INDEX_BASE;   // 10000 : 50
  const overlayZIndex = baseZ + depth * Z_INDEX_PER_DEPTH;     // + depth * 10
```

Escape ownership comes from `isTopmost` — registry order, correct. Paint order
comes from `overlayZIndex` — and `portal` moves the base by **9,950**. A
non-portal modal would need `depth === 995` to out-paint a portal one, so for
every stack this app can produce:

> **If a non-portal modal opens on top of a portal modal, the stack says the new
> modal owns Escape and the compositor draws it underneath.**

The split is not a corner case. Measured at `313dc6a84`: **62 of 129 render
sites pass `portal`, 67 do not** — 48.1% / 51.9%. Both halves are ordinary
feature modals; `ConfirmDialog` (the shared confirm primitive, used everywhere)
is on the portal side at `:58`, and 67 sites that can be opened from inside one
are not.

**The repo has already hit this and paid for it three times, in writing.** Each
of these three hand-rolled overlays exists *specifically* to get above
`Z_INDEX_PORTAL_BASE`, and each one names the constant in a comment:

| file | z-index | its own comment |
| --- | --- | --- |
| `templates/sub_generated/adoption/chronology/TestReportModal.tsx:65-68` | `z-[10001]` | "so the report overlays BaseModal portals (which use z-[10000]) when opened from inside the Adoption Wizard — without this bump the report renders DOM-later but visually-below the wizard frame" |
| `agents/sub_glyph/commandPanel/composer/ComposerPickerShell.tsx:77-78` | `z-[10050]` | "sits above the portaled BaseModal base (Z_INDEX_PORTAL_BASE = 10000) so these pickers stack over a modal that opened them" |
| `templates/sub_generated/adoption/ucPicker/ucPreviewModal.tsx:21` | `z-[10500]` | *(via `containerClassName`, which additionally discards the computed z-index entirely — §7 D3)* |

That is the second-pass finding the contract asks for: **a measurable share of
this leaf's deviations are not carelessness, they are the workaround for one
gap.** Three engineers reached the same conclusion independently — that
`BaseModal` cannot express *"above the modal that opened me"* — and each one
left the primitive to say it. Fix the layer model and three of the twenty
hand-painted backdrops stop having a reason to exist.

Two more numbers frame everything below.

**The primitive is well built and widely adopted.** 129 render sites; a real
stack registry with `depth` / `total` / `isTopmost` and subscriber notification
(`ModalStackContext.tsx:27-77`); Escape gated on `isTopmost`
(`BaseModal.tsx:198-203`); Tab cycled in both directions
(`:205-226`); one keyboard arbiter with a documented priority ladder
(`AppKeyboardProvider.tsx:26-40`). **Zero of the four UI-bearing sibling
checkouts has a stack registry at all** — the fifth, `personas-cloud`, has no
frontend to have one (§10). This is a case of Personas being ahead of the fleet,
and it should be copied, not re-derived.

**And the gate that is supposed to protect it is pointed at the wrong thing.**
`custom/enforce-base-modal` is `"warn"` (`eslint.config.js:95`), fires **8**
times, and — hand-verified, all 8 opened — **0 of the 8 are modals.** They are
anchored popovers and one inline notice. Meanwhile the 19 files that *do*
hand-roll a full-viewport modal contain **zero** `role="dialog"` attributes, so
the rule cannot see a single one of them. Precision **0/8**, recall **0/19**.
The rule keys on the marker that only the *conscientious* author writes.

---

## 1. Trigger

You are in this situation when you would say, or type, any of:

1. "This modal needs to open another modal." / "a confirm inside the wizard"
2. "Escape closes the wrong one." / "Escape closes both."
3. "The second dialog renders behind the first." / "I need a bigger z-index."
4. "The modal disappears when the row unmounts." / "I need it to outlive the panel."
5. "The page scrolls behind the dialog."
6. **The "about to write X" test:** you are about to type `fixed inset-0` next
   to `bg-black/`, or `z-[1` followed by four digits, or
   `addEventListener('keydown', …)` inside a component that renders a panel over
   the app. Any of the three means you are re-implementing a modal host.

## 2. The one way

**Render `<BaseModal>` and stop.** Import it from
`@/features/shared/components/modals` (a one-line re-export of the source of
truth at `@/lib/ui/BaseModal`), give it `isOpen`, `onClose` and `titleId`, and
write nothing else about overlays: it owns the backdrop, the portal, the
`role="dialog"` / `aria-modal`, the focus trap, the focus restore, its
registration in the app-wide modal stack, and — through that registration — the
rule that **Escape belongs to the topmost modal only**. Keep the modal mounted
and drive it with `isOpen={expr}` rather than `{open && <Modal isOpen …/>}`,
because the unmounting form is the one branch of the primitive's lifecycle that
does not restore focus to the control the user pressed (§7 D4). Never set a
z-index yourself and never pass `containerClassName` — both discard the
depth-derived stacking the registry exists to compute (§7 D3); if you need a
wider panel say `size` or `maxWidthClass`, and if you need a drawer say
`placement="right-drawer"`. If you genuinely need a surface that is *not* a
modal — a menu, a hover card, a popover anchored to a trigger — you are on a
different leaf: use `useClickOutside` and read
[`anchored-popover`](./anchored-popover.md), and do **not** reach for
`role="dialog"` to make it feel official, because that attribute is the one
thing in this repo that summons a lint warning telling you to do the wrong
thing.

## 3. Mandated primitives

| primitive | what it gives you |
| --- | --- |
| `@/features/shared/components/modals` → `BaseModal` | the whole contract below; re-exports `@/lib/ui/BaseModal` (`modals/index.ts:1-5`) |
| `BaseModal` props `isOpen` / `onClose` / `titleId` | the only three that are required (`BaseModal.tsx:26-28`) |
| `BaseModal` prop `size` \| `maxWidthClass` | width, from a closed 6-member union (`:12-19`) — never a raw class on the container |
| `BaseModal` prop `placement="right-drawer"` | full-height right-edge drawer with its own slide-in variants (`:109-121`); 4 sites use it |
| `BaseModal` prop `portal` | `createPortal` to `document.body`, escaping a transformed / `overflow-hidden` ancestor (`:301`) |
| `BaseModal` prop `staggerChildren={false}` | opt out of per-child stagger; **required** for a flex-column header/body/footer panel (`:38-43`), used at 43 sites |
| `ModalStackProvider` | the registry; mounted once at `App.tsx:310` |
| `useModalStackPosition(isOpen)` | `{ depth, total, isTopmost }` — you should never call this directly; `BaseModal` does (`:156`) |
| `useAppKeyboard(handler, { priority, enabled })` | the single keyboard arbiter; `BaseModal` registers at priority **80** (`:227`) |
| `shared/components/feedback/ConfirmDialog` | a confirm built *on* `BaseModal` (`:58`, `portal`) — use it rather than a bespoke yes/no modal |
| `shared/components/overlays/{ConfirmDestructiveModal,UnsavedChangesModal}` | the two other pre-built decision modals, both on `BaseModal` |

**Do not invent a name.** There is no `useModalStack()` hook, no `ModalHost`,
no `zIndex` prop, and no `onEscape`. The registry's public surface is exactly
`ModalStackProvider` and `useModalStackPosition`.

## 4. Steps

1. **Decide it is a modal.** Modal = it blocks the app, it has a dimming
   backdrop, and Escape should close it. If any of those is false, stop — this
   is the wrong leaf.
2. **Render `<BaseModal isOpen={expr} onClose={…} titleId="…">`** with a bound
   expression, and keep the element mounted. Put the `id={titleId}` on the
   heading inside.
3. **Choose width and shape from the props**, never from a container class:
   `size="lg"`, or `maxWidthClass`, or `placement="right-drawer"`.
4. **Decide `portal` by ancestry, not by taste.** Pass `portal` when any
   ancestor is transformed, `backdrop-filter`ed, or `overflow-hidden` — that is
   what `ComposerPickerShell.tsx:69-75` documents from experience. Then read §7
   D1, because `portal` is currently also a z-layer choice and the two decisions
   are fused.
5. **If the panel is a flex column with a `flex-1 overflow-y-auto` body, pass
   `staggerChildren={false}`.** The stagger wrapper is a block-level
   `motion.div` and silently kills the flex chain (`BaseModal.tsx:38-43`; the
   symptom is documented at `AdoptionWizardModal.tsx:154-163`).
6. **And then stop.** Do not add a `keydown` listener, do not add a backdrop
   `div`, do not add `role="dialog"`, do not add a focus effect, do not add a
   z-index. Every one of those is already there, and every one of them is
   *worse* when duplicated: a second Escape listener at priority 0 fires for a
   modal that is not topmost, and a second backdrop dims twice.
7. **If the modal must outlive the subtree that opened it**, hoist the *host*,
   not the modal: mount a small always-rendered component at `App.tsx` that
   reads its open-state from a store, the way `ResourcePickerHost` does
   (`App.tsx:398-402` and the comment above it). This is the only sanctioned
   app-root-host pattern in the repo, and there is exactly one instance of it.

### Can the primitive's signature make the wrong call impossible?

Asked before §9, per the contract. Three answers, and two of them are yes:

- **`portal: boolean` should be a closed layer union.** Today `portal` decides
  *two* things — whether to `createPortal`, and which of two z-bases 9,950 apart
  to use — and a caller can only ask for the pair. Replacing it with
  `layer?: 'inline' | 'overlay' | 'above-overlay'`, where the component derives
  both the portal decision and the base, makes "portaled but painted low" and
  "non-portal above a portal" unspellable, and gives the three workaround
  overlays in §0 a legal way to say what they mean. This is qualification **Q2**
  (closedness, not requiredness, is the win) and **Q5** (withhold the raw
  boolean and the raw z-index; hand back a named layer).
- **`containerClassName` should not be able to disable `style`.** The line
  `style={containerClassName ? undefined : { zIndex: overlayZIndex }}`
  (`:278`) is a *withholding* failure in the Q7 sense: the caller was handed the
  whole container to rewrite, and all 8 callers used it to write a z-index by
  hand. Merging the computed `zIndex` in unconditionally removes the class
  permanently. (Deferred — it changes what 8 live modals paint; see §9.)
- **`titleId: string` cannot be made safer.** It is already required, and
  requiring it does not make the matching `id=` exist on a heading — Q1: a
  required prop carries only what it encodes.

## 5. Anti-patterns

**A. `fixed inset-0` + `bg-black/N` + `onClick={onClose}`.** The 20-site idiom.
Failure mode: no Escape (11 of 19 files), no focus trap (18 of 19), no focus
restore (18 of 19), no `aria-modal` (19 of 19), and — the one that only bites in
a stack — **no registration**, so the modal underneath still believes it is
topmost and still answers Escape.

**B. Adding `role="dialog"` to a popover to make it "accessible".** It is the
one attribute in this repo that triggers a lint warning
(`custom/enforce-base-modal`) advising you to convert an anchored popover into a
centred modal. 8 files carry that warning today and all 8 should ignore it; 4
more already suppress it with a prose reason. Failure mode: either you take the
advice and break the UI, or you add a suppression comment and the rule's signal
degrades further.

**C. `{open && <Modal isOpen … />}`.** Reads as the tidy form and is the one
shape `BaseModal`'s focus restore cannot serve: the restore lives in an effect
*body* keyed on `isOpen` (`:229-233`), not in a cleanup, so unmounting while
open skips it and focus falls to `<body>`. 96 of 129 sites are in this shape.

**D. A bare `window.addEventListener('keydown', …)` for Escape.** Bypasses the
priority ladder entirely, so it fires for a surface that is not topmost. 8 of
the 19 hand-rolled overlays do this; `unregistered-key-handler` already counts
7 of them (§11).

**E. A hand-written z-index to win a fight with another overlay.** It works
once and then it is a constant that nobody can reason about. This repo now
contains `z-40`, `z-50`, `z-[60]`, `z-[100]`, `z-[120]`, `z-[200]`, `z-[300]`,
`z-[9995]`, `z-[9996]`, `z-[9999]`, `z-[10001]`, `z-[10002]`, `z-[10050]`,
`z-[10500]` — **25 literal `z-[≥1000]` values across 21 files** — plus the two
`BaseModal` constants they are all negotiating with.

**F. Wrapping a component that already renders `BaseModal` in your own
backdrop.** `TestReportModal.tsx:312-320` portals a `fixed inset-0 z-[10002]
bg-black/40 surface-blur-modal` around `<CatalogCredentialModal>`, which itself
returns `<BaseModal isOpen …>` (`CatalogCredentialModal.tsx:93`). Two dimming
layers, one of them outside the stack.

**G. `onClick={(e) => e.stopPropagation()}` on the panel.** The idiom that
accompanies A at 12 of 19 sites. It does not solve the real problem (a
`pointerdown` on the backdrop followed by `mouseup` inside the panel still
dismisses in the browsers where the handler is on `click`), and it silently
kills legitimate bubbling for anything above the modal.

## 6. Evidence

**The one site to copy: `src/features/shared/components/feedback/ConfirmDialog.tsx`.**
50 lines of component, zero lines about overlays. It renders
`<BaseModal isOpen={open} onClose={onCancel} titleId=… portal size="sm">`, puts
its heading on the `titleId`, and lets the primitive do everything else. It is
also the right kind of exemplar for *stacking* specifically, because it is the
modal most likely to be the second one open.

Other exemplary sites, each for one clause:

- `lib/ui/ModalStackContext.tsx:27-77` — the registry. `stackRef` is a plain
  ref, mutations are copy-on-write, and a subscriber `Set` drives re-render.
  Note `isTopmost` reads the **last** entry, and `register()` appends, so
  registry order is open order with no sorting to get wrong.
- `lib/keyboard/AppKeyboardProvider.tsx:26-40` — the priority ladder, written
  down, with `BaseModal` at 80 and a named reason for every rank.
- `lib/ui/BaseModal.tsx:198-203` — the four lines that make stacking correct:
  `if (!isTopmost) return false;` *before* `onClose()`, and returning `true` to
  stop the ladder. A non-topmost modal declines the key rather than consuming
  it.
- `App.tsx:398-402` — the app-root-host pattern and its rationale ("Mounted at
  App root so the picker outlives parent unmounts when Catalog dispatches
  GO_LIST, autopilot panels reset, or edit forms close after save").
- `agents/quick-answer/triage/deck/useDeckDialog.tsx` — **the sanctioned
  exception, and the template for how to write one.** It reimplements
  `BaseModal`'s focus capture / rAF-focus / Tab cycle / restore for a full-app
  surface pinned under the title bar, and it says so in a 20-line header naming
  what it took from `BaseModal` and the one clause it changed
  (`!root.contains(active)`); its consumer carries a single-line
  `eslint-disable-next-line custom/enforce-base-modal` with a full prose reason
  (`TriageDeckVariant.tsx:174`). If you must deviate, deviate like this.

## 7. Deviations

Every entry below shipped under a green `npm run check`.

### D1 — Two z-index bases, one stack order (62 / 67)

`Z_INDEX_BASE = 50`, `Z_INDEX_PORTAL_BASE = 10000`, `Z_INDEX_PER_DEPTH = 10`
(`BaseModal.tsx:8-10`). Paint order is `base + depth*10`; Escape order is
registry position. The two agree only within one base. **62 render sites pass
`portal`, 67 do not**, and nothing prevents a non-portal modal from opening on
top of a portal one. Severity: the user presses Escape and the dialog they can
see stays open. P1.

### D2 — Three overlays exist only to escape D1

`TestReportModal.tsx:68` (`z-[10001]`), `ComposerPickerShell.tsx:89`
(`z-[10050]`), `ucPreviewModal.tsx:21` (`z-[10500]`). All three name
`Z_INDEX_PORTAL_BASE` or "BaseModal portals" in a comment. All three are
therefore *outside* the stack: none registers, none is counted for `total`, and
each of the three answers Escape (or does not) on its own terms. Fixing D1
retires all three. P1.

### D3 — `containerClassName` silently discards the depth-derived z-index — 8 sites

`style={containerClassName ? undefined : { zIndex: overlayZIndex }}`
(`BaseModal.tsx:278`). Passing the prop for *any* reason — padding, alignment —
drops the computed stacking. All 8 call sites noticed and wrote a z-index by
hand, and the values do not compose:

| site | value passed | what is wrong with it |
| --- | --- | --- |
| `agents/sub_glyph/GlyphFullLayout.tsx:335` | `fixed inset-0 z-40 …` | **below** `Z_INDEX_BASE` (50) — any default modal paints over it |
| `templates/…/gallery/modals/TemplateDetailModal.tsx:145` | **`absolute` inset-0 z-50 …** | not `fixed`; clipped to the nearest positioned ancestor |
| `shared/components/overlays/FirstUseConsentModal.tsx:158` | `fixed inset-0 z-[9999] …` | ties with ResourcePicker; order decided by DOM |
| `vault/…/picker/ResourcePicker.tsx:187` | `fixed inset-0 z-[9999] …` | ties with FirstUseConsentModal |
| `overview/…/widgets/DetailModal.tsx:28` | `fixed inset-0 z-[200] …` | above non-portal, below portal — a third tier |
| `plugins/drive/components/DriveImageLightbox.tsx:301` | `fixed inset-0 z-[100] …` | ditto |
| `vault/shared/vector/ingest/IngestTextModal.tsx:45` | `fixed inset-0 z-[60] …` | one depth level above base — collides at `depth == 1` |
| `templates/…/ucPicker/ucPreviewModal.tsx:27` | `fixed inset-0 z-[10500] …` | the D2 workaround |

P1. **Not applied** — the one-line fix (merge `zIndex` instead of replacing
`style`) changes what 8 live modals paint. §9 / deferred item 82.

### D4 — Focus restore is unreachable for 96 of 129 render sites

`BaseModal.tsx:229-233` restores focus in an effect **body** guarded by
`if (isOpen) return;`. That fires when `isOpen` flips true→false on a mounted
component. It cannot fire when the component unmounts while open, because there
is no cleanup. Measured two ways (129 sites; the two implementations disagreed
by exactly one site and the cause is recorded in §12.2):

| shape | sites | focus restored on close? |
| --- | --- | --- |
| `isOpen` bare or `isOpen={true}` — parent unmounts to close | **96** | **no** |
| `isOpen={expr}` — stays mounted | 33 | yes |

Two sibling repos get this right and both do it the same way — the restore is in
the effect's **cleanup** (`personas-web/src/hooks/useFocusTrap.ts:87-91`;
`ascent/src/components/ui/Modal.tsx:85`). This is the one clause on which
Personas is behind the fleet. P1.

### D5 — 20 hand-painted modal backdrops across 19 files, with no modal behaviour at all

The census rule's population. Profile over the 19 files:

| property | files |
| --- | --- |
| `role="dialog"` | **0** |
| `aria-modal` | **0** |
| registers in the modal stack | **0** |
| uses `useAppKeyboard` | **0** |
| cycles Tab inside the panel | 1 (`Sidebar.tsx`) |
| saves `document.activeElement` | 1 (`Sidebar.tsx`) |
| handles Escape (own `window` listener) | 8 |
| dismisses on backdrop click | 12 |

Full list, in census order: `ComposerPickerShell.tsx:89`,
`EventRenameModal.tsx:176`, `DecisionDrawer.tsx:54`, `MemoryDetailModal.tsx:35`,
`BulkAddTagModal.tsx:18`, `Gallery2D.tsx:312`, `Gallery3D.tsx:125`,
`TagEditorModal.tsx:73`, `TextLane.tsx:51`, `ScanOverlay.tsx:31`,
`CrossProjectMetadataModal.tsx:301`, `RecipePicker.tsx:39`,
`FrequencyEditor.tsx:101`, `ApiKeyAuditDrawer.tsx:68`,
`CreateApiKeyDialog.tsx:104`, `CreatedKeyDialog.tsx:85`, `Sidebar.tsx:190`,
`TestReportModal.tsx:68`, `TestReportModal.tsx:314`,
`QuickAddCredentialModal.tsx:139`. P2 each, P1 as a class.

Two of the 20 are defensible as-is and should be argued rather than converted:
`Sidebar.tsx:190` is a mobile nav scrim (and is the only one of the 20 with a
focus trap), and `CreatedKeyDialog.tsx:85` deliberately omits backdrop dismissal
with a written reason ("the user must explicitly acknowledge they've stored the
plaintext"). Neither reason argues against `BaseModal`; both are satisfiable
with props.

### D6 — `custom/enforce-base-modal`: warn-level, 0/8 precision, 0/19 recall, satisfied by an import

Four independent failures in one 84-line rule:

1. **Severity.** `eslint.config.js:95` sets it to `"warn"`. Per
   [doctrine §3](../golden-path-doctrine.md#3-the-severity-fact), a warn-level
   rule enforces nothing at either gate, at any count. `.claude/CLAUDE.md`
   describes this rule as *"enforced by `custom/enforce-base-modal`"* — the word
   is wrong (§12.1).
2. **The signal is anti-correlated with the defect.** It anchors on
   `role="dialog"` (`enforce-base-modal.cjs:63-73`). Executed over its whole
   anchor population: 16 files contain the attribute, 8 reports fire. Opened one
   by one, **0 of 8 are modals** — `FindingBadge.tsx:210` and
   `passportWidgets.tsx:187` are info tips, `WarningBadge.tsx:107`,
   `DataLinksPopover.tsx:80`, `DeployPopover.tsx:55`, `ImprovePopover.tsx:91`
   and `StandardsScan.tsx:111` are portaled anchored popovers positioned from a
   trigger rect, `DemoNotice.tsx:23` is an `absolute inset-0` in-card notice.
   Converting any of them to `BaseModal` would be a regression. Meanwhile the 19
   files in D5 carry **zero** `role="dialog"`, so recall is 0.
3. **The check is on the import, not the use.** `importsBaseModal` is satisfied
   by any import whose source merely *contains* the substring `BaseModal`, and
   by `source === '@/features/shared'` — a barrel import of anything at all
   (`:40-48`). A file can import `BaseModal`, never render it, hand-roll a
   dialog, and pass.
4. **Its own fixtures cannot fail on the real condition.** `RuleTester` at
   `src/test/eslint-rules/customRules.test.ts:46-64` has two `invalid` cases,
   neither containing `fixed inset-0`, and one `valid` case that would still
   pass if the import were unused. The fixtures were written from the same idea
   as the rule, so no fixture exists that could contradict it — the doctrine's
   *"a test that runs on one side of a boundary is a third copy, not a check"*,
   wearing a third costume.

P1. **Not applied** — raising severity or changing the signal changes what every
running session's editor reports. Deferred item 76.

### D7 — `embedded` leaves the stack but keeps the keyboard

`useModalStackPosition(isOpen && !embedded)` (`:156`) returns `null` for an
embedded modal, so `isTopmost` falls back to `true` (`:157`) — while
`useAppKeyboard` is called unconditionally, before the `embedded` early return,
at priority 80 and `enabled: isOpen` (`:198-227`). An open embedded modal
therefore claims topmost-hood it was explicitly excluded from. One site passes
it today (`vault/sub_catalog/components/design/CredentialDesignModal.tsx:27`) and
passes it as a *variable*, so the same component is inside the stack on some
routes and outside it on others. P2.

### D8 — the backdrop's `onClose` is not gated on `isTopmost`

`onClick={onClose}` on the backdrop (`:283`) has no topmost check, unlike
Escape. Today the higher-depth overlay covers the lower one so the click cannot
land — but that safety is *exactly* the z-index ordering D1 and D3 break. When
paint order and stack order disagree, a click on the visible backdrop closes a
modal the user cannot see. P2.

### D9 — the modal-host pattern exists once and is not named

`ResourcePickerHost` (`App.tsx:398-402`) is the repo's only instance of "mount
the modal at the root so it outlives the subtree that opened it", and it is a
bespoke component with a comment rather than a reusable primitive. Two of the
three names this leaf was merged from ("App-root modal host") therefore have a
sample size of one. Not a defect; a gap in the catalog (§8 G4). P3.

### D10 — 25 literal `z-[≥1000]` values across 21 files

Enumerated at §5 E. The stack computes 10 units per depth; the hand-written
values are 100× apart and were each chosen against a different neighbour. There
is no shared scale to consult — `styles/globals.css` defines none, and the two
`BaseModal` constants are module-private. P2.

## 8. Gaps — what the primitive genuinely cannot do

**G1. `BaseModal` cannot express "above the modal that opened me."** `portal`
is the only layer control and it is a boolean over two fixed bases. This is
upstream of D1, D2, D3 and D10 — four deviations, one gap. Fix: the closed
`layer` union in §4.

**G2. The stack registers a position, not an identity.** `ModalStackEntry` is
`{ id: number }` (`ModalStackContext.tsx:12-14`), and `useModalStackPosition`
only answers questions about *your own* entry. Nothing outside `BaseModal` can
ask "is any modal open?" or "what is on top?" — which is why every non-modal
overlay in the app (command palette, tour, orb layer, toasts) negotiates z-index
by hand instead of asking. Adding `useIsAnyModalOpen()` would be a small,
non-breaking addition.

**G3. The registry degrades silently when absent.** `useModalStackPosition`
returns `null` with no provider, and `BaseModal` reads that as
`isTopmost = true` (`:157`). The fallback is documented as deliberate ("so
BaseModal can fall back to legacy single-modal behaviour without crashing in
tests or storybooks") and it is the right default for one modal — but it is also
the mechanism behind D7, and there is no dev-mode warning distinguishing "no
provider" from "not registered".

**G4. There is no app-root modal-host primitive.** See D9. A repo with 129
modals and one host has not yet had the problem often enough to generalise, but
the leaf's own name says it will.

**G5. Focus restore cannot simply move to a cleanup.** The naive fix for D4
(move `triggerRef.current?.focus()` into the effect's cleanup) fires during
`AnimatePresence`'s exit animation — 160 ms with a 120 ms backdrop delay
(`:51`, `:69-77`) — so focus lands on the trigger while the panel is still
painted. A correct fix needs both arms: restore in the cleanup *and* keep the
`isOpen`-flip arm, with a guard against double-firing. That is why D4 is not a
one-liner.

**G6. There is no body-scroll-lock, and this app does not need one.**
`styles/globals.css:562` sets `body { overflow: hidden }` app-wide; every scroll
region is an inner `overflow-y-auto`. So the classic modal question — *is the
scroll lock refcounted or a one-way latch* — **has no instance here**, and a
grep for `useScrollLock` / `document.body.style.overflow` returns zero
lock-shaped hits in 4,801 files (the 6 hits are `cursor` and `userSelect` writes
by two column resizers and the dev inspector). This is a **structural** absence,
not a missing feature, and it is the single most important thing to re-derive
before adopting this path in a repo whose body scrolls — where, as §10 shows,
the defect is alive and well.

## 9. The missing gate

### What would have caught this

Not the rule that exists. The condition is *"a full-viewport dimming layer that
is not the modal host's"*, and the proxy that survives contact with this repo's
formatting is **paint on the positioning element itself**: `BaseModal` puts
`fixed inset-0` on a container that carries no colour and renders the scrim as a
separate `absolute inset-0` child (`:256-285`), so a class string containing
both `fixed inset-0` and a dimming token is a shape the primitive never emits.

State that explicitly for the next repo: **the signal is a proxy for "an overlay
painted its own backdrop", and it is keyed on this repo's Tailwind idiom.** A
codebase using styled-components, CSS modules or a `Backdrop` component must
re-derive a different proxy for the same condition. The four §9 signals the
[portability test](../research/portability-test.md) killed all failed by
travelling as markup.

### The rule

```json
{
  "id": "hand-painted-modal-backdrop",
  "goldenPath": "docs/concepts/golden-paths/modal-stacking.md",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "fixed inset-0[^\"'`\\n]*(?:bg-black\\/|bg-background\\/[0-9]|bg-secondary\\/[0-9]|backdrop-blur|surface-blur)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A full-viewport dimming layer painted directly on the `fixed inset-0` element — the hand-rolled modal backdrop. BaseModal never emits this shape (its container carries no paint; the scrim is a separate `absolute inset-0` child), so a match is an overlay built outside the modal host: no stack depth, no Escape arbitration, no focus trap, no focus restore."
  },
  "baseline": { "files": 19, "matches": 20 },
  "floor": 1800
}
```

```json
{
  "id": "hand-painted-modal-backdrop-positive-control",
  "goldenPath": "docs/concepts/golden-paths/modal-stacking.md",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<BaseModal(?![A-Za-z0-9_$])",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL — the compliant construction of the same situation: an overlay rendered through the modal host."
  },
  "floor": 1800
}
```

**Validated** in a private registry at `313dc6a84`: rule **19 files / 20
matches**, control **128 files / 129 matches**, 2,083 files walked against a
floor of 1,800. Adoption ratio **129 : 20 — 86.6% of overlay surfaces go
through the host.**

**Why a ratio and not a partition.** The doctrine prefers a control that
partitions the anchor's raw matches. That is unavailable here and the reason is
the finding: the compliant form emits **no** `fixed inset-0`-with-paint at all —
`BaseModal`'s container is unpainted — so violating and compliant do not share a
match to divide. Nine further files (`SkillLibraryDrawer`, `ExperimentRunsDrawer`,
`ReportPreviewDrawer`, `AddPersonaModal`, `DisconnectDialog`,
`IngestDirectoryPicker`, `CommandPalette`, and two click-catchers) hand-roll an
overlay in the *two-element* form — an unpainted `fixed inset-0` container plus a
separate `absolute inset-0` scrim — which is byte-for-byte the primitive's own
shape and is therefore **invisible to any regex that respects the primitive**.
The rule's honest recall against "hand-rolled overlay" is 19 of 28 files
(67.9%); against "hand-*painted* backdrop" it is 19/19.

**Hand-verified precision: 20/20.** All twenty sites opened (listed in D5).
Every one is a `fixed inset-0` element carrying its own dimming paint and not
rendered by `BaseModal`. Two (`Sidebar.tsx:190`, `TestReportModal.tsx:314`) are
argued in D5 as "true match, defensible design"; neither is a false match on the
stated condition.

**Fail-loud.** Inherited from the runner: the `floor: 1800` fails the run if the
walk sees fewer files than a real `src/` contains; a zero-match run fails
structurally; a silent drop fails. One drop cause to name in advance, because
this campaign has already been bitten by it: **deleting a feature moves this
baseline exactly as a fix does.** Six of the 19 files are plugin surfaces
(artist ×4, research-lab ×2) — if a plugin is removed, say so in the commit and
in this section, per the runbook.

**Not a census rule, and why.** Three of this leaf's sharpest findings are
**absences**, which the census cannot express: that no `role="dialog"` exists on
any of the 19 hand-rolled modals (D5), that no cleanup-based focus restore
exists (D4), and that no scroll lock exists or is needed (G6). D1 is worse than
an absence — it is an *arithmetic* relationship between two constants and a
prop, which no count reaches. For D1 the instrument is the type change in §4,
not a gate; for D4 it is a unit test of `BaseModal` (there is none today —
`find src -name "*BaseModal*test*"` returns nothing).

**A declined second rule.** A rule on `z-\[\d{4,}\]` would fire 25 times across
21 files and would be **wrong on most of them**: the popover cluster
(`WarningBadge`, `DataLinksPopover`, `DeployPopover`, `ImprovePopover`,
`StandardsScan`, `passportWidgets`, `Tooltip`, `ThemedSelect`,
`DriveContextMenu`) legitimately needs a high z-index because it is portaled and
is not a modal. Precision would be roughly 9/25 = 36%, below every threshold the
doctrine records for a refusal, and the *correct* fix is G1's shared layer scale
rather than a count. Declined.

## 10. Convergence — `mixed` **holds**, and it is the second spine label to survive

Cohort established for this leaf at measurement time: **four independent
UI-bearing checkouts**, not five. `personas-cloud` has no frontend at all (3
Node packages, 32 `.ts` files, no `react` anywhere), so it cannot witness. Per
the doctrine's lineage rule, `vibeman` is treated as an **ancestor**, and its
agreement is weighted accordingly.

| clause | personas-web | brainiac | vibeman | ascent | Personas | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| a shared modal primitive exists | 1, dashboard-scoped (3 of ~18 overlays) | 0 | **3 competing** | 1 (4 of 6) | 1 (129 of 149) | **converged on having one**, and Personas has the highest adoption |
| a modal **stack registry** | **0** | 0 | **0** | **0** | **yes** | **converged on the absence** — Personas is alone |
| an Escape **arbiter** | 0 (22 listeners) | 0 (2, none on the dialog) | 0 (29 listeners) | 0 (11) | `AppKeyboardProvider` | Personas alone |
| body **scroll lock** | refcounted + 1 bypass | 0 | per-instance latch | **one-way latch** | none needed (`globals.css:562`) | **genuinely mixed** |
| focus **restore in cleanup** | **yes** | 0 | partial | **yes** | **no** (D4) | **mixed — Personas behind** |
| app-root modal **host** | 0 | 0 | single-slot provider | portal target | 1 bespoke | mixed |

Two converged clauses (one on presence, one on absence) and three genuinely
split. **`mixed` is the right label**, which makes this the second spine
convergence label the corpus has upheld after
[`ai-draft-preview-apply`](./ai-draft-preview-apply.md) — and, like that one, it
was reached by sizing the cohort first.

Three results are worth more than the table:

**The one-way scroll-lock latch is real, and it is in a sibling.** `ascent`'s
`ui/Modal.tsx:80-84` captures `prevOverflow`, writes `hidden`, and restores in
cleanup — duplicated verbatim in `ScanModal.tsx:126-130`, with no counter. LIFO
close order happens to work. Non-LIFO does not: the outer modal closes first and
writes `""` while the inner is still open (the page scrolls behind the dialog),
then the inner closes and writes back `"hidden"` — leaving the page
**permanently frozen with no modal on screen**. That is the canonical bug this
leaf's brief predicted, found in a repo that *has* the problem, and it is the
strongest possible argument for G6's warning: Personas is protected by an
accident of layout, not by a decision, and any port of this path must re-derive
the lock.

**The fleet converged on the disease, and the ancestor shows the shape.**
`vibeman/src/components/ui/modal/DynamicModalShell.tsx:52` has
`isTopMost = true` as a **hardcoded default prop**, and
`useGlobalModal.tsx:138` passes `isTopMost={shell.isTopMost ?? true}` — the same
identifier, the same default, and *nothing computes it*. Personas' `stackPosition?.isTopmost ?? true`
(`BaseModal.tsx:157`) is that expression with a registry behind it. Given the
established direction (vibeman predates Personas), the honest reading is that
Personas **inherited the concept and then built the thing the ancestor only
declared** — which is what makes the surviving `?? true` fallback in D7 an
inherited artefact rather than an oversight.

**And vibeman shows what happens without an arbiter.**
`UniversalModal.tsx:136` registers its Escape handler with `{ capture: true }`
and calls `stopPropagation()`, so the global single-slot modal intercepts the
key **before** any nested `BaseModal` can see it. An escalation race is what a
priority ladder replaces; `AppKeyboardProvider`'s 100→0 table is the answer, and
it is not present anywhere else in the cohort.

**`sides: "client"` — upheld**, for the same structural reason the doctrine
records for the only two prior upholdings: *the server never sees the DOM*.
Nothing in 564 `.rs` files participates in modal stacking, and no measurement in
this document has a server half.

## 11. Cross-check against the neighbours' prescriptions

Measured at **site level, against the final patterns**, by applying all 184
published rules' regexes to this rule's 19 matched files and comparing match
offsets (±120 bytes).

**Site overlap with every existing rule: 0.** File overlap is substantial and
misleading — `catalog-boundary-escape` matches 13 of my 19 files (29 matches),
`typo-token-overpainted` 8, `native-title-tooltip` 7 — because a 300-line modal
file does many things. Not one of those 200+ matches lands within 120 bytes of
one of my 20 sites. This is the doctrine's *"file overlap understates"* running
in the other direction: here it **overstates**, and only the site-level check
shows there is nothing to merge.

The one that needs a seam, not a merge:

- **`unregistered-key-handler`** (from
  [`keyboard-shortcut-registration`](./keyboard-shortcut-registration.md) and
  [`focus-management`](./focus-management.md)) matches **7 of my 19 files, 7
  matches, 0 site overlap.** Those are 7 of the 8 raw Escape listeners in D5 —
  the *same defect seen from the other end*. Its rule counts the listener; mine
  counts the backdrop the listener belongs to. They are complementary and they
  do not double-count. **The seam is clean and both should stay:** converting a
  hand-rolled overlay to `BaseModal` removes one match from each rule, which is
  the correct arithmetic.
- **[`anchored-popover`](./anchored-popover.md)** prescribes `useClickOutside`
  for dismissal. Following that prescription and this one together is safe —
  they cover disjoint surfaces — but the *boundary* between them is exactly
  where `custom/enforce-base-modal` misfires (D6.2): all 8 of its reports are
  popovers, i.e. that leaf's territory, being told to adopt this leaf's
  primitive. **Neither path's §2 should ever route a popover to `BaseModal`**,
  and this one says so explicitly.
- **[`tooltip`](./tooltip.md)**'s rule `native-title-tooltip` matches 7 of my
  files (16 matches), 0 site overlap — unrelated attributes in the same large
  components.
- **[`focus-management`](./focus-management.md)** §2 says focus is owned by a
  primitive, "if the surface is an overlay, render it with `BaseModal` and
  stop". This path agrees and **sharpens one clause it carries**: `BaseModal`'s
  restore does not cover the unmount-while-open branch, which is 96 of 129
  sites. That is a §12 correction owed to `focus-management` (§12.4).
- **[`hmr-safe-singletons`](./hmr-safe-singletons.md)** supplies this leaf's
  discriminator — refcount vs one-way latch — and the answer here is that the
  population is **empty** (G6). Reported as an absence, not as compliance.

## 12. Corrections

### 12.1 — To `.claude/CLAUDE.md`: `custom/enforce-base-modal` does not enforce, and does not check what its row claims

The reuse table reads:

> `fixed inset-0` modal backdrop → `modals/BaseModal` / `feedback/ConfirmDialog`
> (enforced by `custom/enforce-base-modal`)

Three errors in one parenthesis. The rule is **`"warn"`**
(`eslint.config.js:95`), so it enforces nothing at either gate. It does **not**
key on `fixed inset-0` — it keys on `role="dialog"`, which none of the 19 files
carrying that idiom contains. And it is satisfied by an *import*, not by use.
The row directs a reader to a gate that is, for the row's own stated condition,
inert in all three dimensions. **Not applied** (see §9 / deferred item 82);
recorded here and in the register.

The same paragraph's other claim survives: `BaseModal` really is the right
answer, and `modals/index.ts` really does re-export it under the path the row
gives.

### 12.2 — To this composer's own measurement: 129 vs 128, and a backtick inside a comment

The two required implementations disagreed by exactly one `<BaseModal>` site
(129/96 vs 128/95). The library-backed pass was right. The bespoke scanner read
**raw** source and its quote tracker treated the backtick in
`` `motion.div` `` — inside a `//` comment *within the JSX open tag* at
`AdoptionWizardModal.tsx:154-156` — as opening a template literal, swallowing
the rest of the tag so it never found the closing `>`. Recorded because the
failure is silent in the safe direction (an unclosed tag is skipped, not
miscounted) and because it is a live demonstration of why
`instruments/stripComments` exists: the pass that stripped comments first got
it right, and the one that did not lost precisely the most carefully-written
call site in the tree.

### 12.3 — To this composer's own first pass: 28 candidates was a file-level artefact

The first classifier called a file a hand-rolled overlay if it contained `fixed
inset-0` *anywhere* and a dimming token *anywhere*. That returned 28 files, and
at least two were false — `StudioTabBar.tsx:174` and
`TemplateCardHeader.tsx:100` are unpainted `fixed inset-0` **click-catchers**
for dropdown menus, matched only because a `backdrop-blur` sits on the menu
panel elsewhere in the file. Requiring both tokens in the *same class string*
took it to 19 files / 20 sites, which is the published baseline. The 9-file
remainder is not noise — it is the two-element form, and §9 records why no
pattern can see it.

### 12.4 — To [`focus-management`](./focus-management.md) §2

That path's §2 reads: *"If the surface is an overlay, render it with BaseModal
and stop — it captures the trigger, moves focus in on the next frame, cycles Tab
inside the panel and restores focus on close."* Three of those four are exactly
right. **"Restores focus on close" holds only when the component stays mounted**
— the restore is in an effect body keyed on `isOpen` (`BaseModal.tsx:229-233`),
not in a cleanup, and **96 of 129 render sites (74.4%) pass a bare `isOpen` and
are unmounted by their parent to close**, so the restore never runs for them.
Two sibling repos put the same restore in a cleanup and get the unmount branch
for free. A correction is owed in that path's §2 or §7; the fix itself is not a
one-liner (§8 G5).

### 12.5 — To the brief: the scroll-lock question has no instance here, and the rule about the rule was backwards

The brief named body-scroll-lock refcounting as the leaf's canonical bug and
`refcount vs one-way latch` as the useful discriminator. **Personas has no scroll
lock and needs none** — `styles/globals.css:562` sets `body { overflow: hidden }`
app-wide (G6). The discriminator is sound and the brief was right that it
matters; it is simply answered elsewhere, and §10 found the predicted bug intact
in `ascent`.

The brief also said `custom/enforce-base-modal` is *"a real ESLint rule
enforcing it"* and asked, if it were `"error"`, to measure how many `fixed
inset-0` backdrops exist anyway. It is `"warn"`, and the more valuable number
turned out to be the other one: the rule's **precision is 0/8 and its recall is
0/19**, so the count of backdrops existing "anyway" is not a story about a rule
being ignored — it is a story about a rule that has never once looked at them.

### 12.6 — To the brief: the seam with `focus-management` is fine; the seam with `anchored-popover` is the one that is broken

The brief asked to check the `focus-management` seam before publishing. Measured
at site level: 0 overlap, complementary counting, clean (§11). The seam that
actually leaks is with **`anchored-popover`**, and it leaks through the lint
rule rather than through either document: 8 popovers are currently being advised
to become modals, and 4 more carry suppression comments saying so. Both paths
now state the boundary explicitly.

### 12.7 — On the spine labels

`convergence: mixed` **holds** (§10) — the second upholding in the corpus, and
the mechanism is that the leaf decomposes into a hosting half where Personas
leads the cohort 1–0 and a focus-lifecycle half where two siblings lead
Personas. A single enum can carry that verdict precisely because the label
already admits a split.

`sides: "client"` **holds**, structurally: the server never sees the DOM. Per
the doctrine's ledger this is the third upholding of that value and the third
time the same mechanism explains it.

### 12.8 — Not applied

Everything in §7 is a note. D3's one-line fix, D6's severity change and D6's
signal replacement all change what a running app paints or what a running
editor reports, and five composers share this checkout. Written to
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md) as item
**82**.
