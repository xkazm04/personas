# lib (misc 4) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 2 medium / 2 low)
> Context group: Core Libraries & State | Files read: 7 | Missing: 0

## 1. Every mounted BaseModal re-renders on any modal open/close, even when closed
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/lib/ui/ModalStackContext.tsx:108
- **Scenario**: `useModalStackPosition` subscribes to stack notifications unconditionally (`if (!context) return;` — no `isOpen` check). Every component that mounts a `BaseModal` — including the common pattern of rendering `<SomeModal isOpen={false} />` permanently in a page — gets a `forceRender` on every modal open/close anywhere in the app.
- **Root cause**: The subscribe effect at line 108 depends only on `context`, so closed modals stay subscribed and pay a state update + component re-render per stack mutation, even though their return value is `null` before and after.
- **Impact**: N mounted modals × 2 renders per open/close of any dialog. Each render re-runs BaseModal's hook chain (`useReducedMotion`, keyboard registration, variant selection). Bounded but pure waste on a UI-hot path; grows with pages that keep many modals mounted.
- **Fix sketch**: Gate the subscription on `isOpen`: `useEffect(() => { if (!context || !isOpen) return; return context.subscribe(...); }, [context, isOpen])`. Closed modals return `null` regardless of stack state, so they never need notifications. Optionally also skip `forceRender` when the derived `{depth, isTopmost}` snapshot is unchanged (or migrate to `useSyncExternalStore` with a memoized snapshot).

## 2. computeCredentialCoverage has no production caller — the "promotion gate" it documents is not wired
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/validation/credentialCoverage.ts:32
- **Scenario**: A repo-wide grep finds `computeCredentialCoverage` imported only by its own test (`src/lib/validation/__tests__/credentialCoverage.test.ts`) and by `featureParity.test.ts`. No component, hook, or lifecycle code calls it, despite the module docstring claiming it is "Used by the build lifecycle to gate promotion from draft to production."
- **Root cause**: The legacy `computeCredentialCoverage(components)` API was retired (per featureParity.test.ts comments) and re-implemented with a new signature, but the runtime call site was never (re)connected — only the parity tests were.
- **Impact**: 60 lines of tested-but-inert validation logic; worse, the docstring asserts a safety gate that does not actually run, which can mislead future readers into believing promotion is credential-gated. Needs cross-context verification (Rust-side promotion flow may implement its own check).
- **Fix sketch**: Verify the promotion/build-lifecycle flow (agents matrix / builder) and either wire `computeCredentialCoverage` into the actual gate, or delete the module + tests and correct featureParity.test.ts. At minimum, fix the docstring so it stops claiming an enforcement point that does not exist.

## 3. hexToRgb duplicated in contrastRatio.ts; color utils exported but never imported elsewhere
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/theme/contrastRatio.ts:16
- **Scenario**: `src/lib/theme/contrastRatio.ts` defines its own private `hexToRgb`, byte-for-byte the same job as the `hexToRgb` exported from sibling `deriveCustomTheme.ts:30`. Meanwhile `hexToRgb`/`hexToHsl`/`hslToHex` are `export`ed from deriveCustomTheme.ts but no other module imports them.
- **Root cause**: Color-math helpers grew inside the theme-derivation module instead of a shared `src/lib/theme/color.ts`, so the sibling file re-implemented the piece it needed.
- **Impact**: Minor drift hazard (e.g. one copy gaining 3-digit-hex or `#`-less handling and the other not) and misleading public API surface on deriveCustomTheme.
- **Fix sketch**: Extract `hexToRgb`/`hexToHsl`/`hslToHex` into `src/lib/theme/color.ts`, import from both deriveCustomTheme.ts and contrastRatio.ts, and stop exporting them from deriveCustomTheme (verify no test imports them directly first).

## 4. Focus-trap focusable-selector string duplicated inside BaseModal
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/ui/BaseModal.tsx:188
- **Scenario**: The long focusable-elements CSS selector (`'button:not([disabled]), [href], input:not([disabled]), …'`) appears twice in the same component — once in the initial-focus effect (line 188) and once in the Tab-trap handler (line 207).
- **Root cause**: Copy-paste within the file; no shared constant.
- **Impact**: If one copy is amended (e.g. adding `[contenteditable]` or `summary`), initial focus and the Tab trap will disagree about what is focusable, producing a subtle keyboard-nav bug.
- **Fix sketch**: Hoist a module-level `const FOCUSABLE_SELECTOR = '…';` next to `SIZE_CLASSES` and use it in both `querySelector` calls. Two-line change, no behavior difference.
