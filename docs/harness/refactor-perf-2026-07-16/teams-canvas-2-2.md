# teams/canvas [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 1 high / 2 medium / 0 low)
> Context group: Execution & Orchestration | Files read: 10 | Missing: 0

## 1. Eager barrel import in PersonasPage pulls the whole canvas feature (incl. @xyflow/react runtime) into the initial bundle
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: bundle
- **File**: src/features/teams/sub_canvas/index.ts:1 (consumer: src/features/personas/PersonasPage.tsx:14)
- **Scenario**: PersonasPage is the eagerly-loaded top-level page. It imports only `CanvasDragProvider` — but does so through the `sub_canvas` barrel, whose 30+ re-exports include modules with runtime `@xyflow/react` imports (`ConnectionEdge`/`GhostEdge` → `BaseEdge`, `PersonaNode` → `Handle`, `AlignmentGuides` → `useViewport`) plus the full debugger/assistant/toolbar tree.
- **Root cause**: The barrel is the only import path a consumer outside the feature uses (grep: PersonasPage is the barrel's SOLE consumer; every internal use is relative). One tiny context provider is fetched through a re-export hub that transitively loads the entire canvas module graph.
- **Impact**: Defeats the page's own lazy-loading discipline (every other heavy feature in PersonasPage goes through `lazyRetry`). @xyflow/react and all canvas components land in the eager chunk / dev module graph even when the user never opens the canvas; in Turbopack dev every one of these modules is compiled at startup.
- **Fix sketch**: Change PersonasPage to `import { CanvasDragProvider } from '@/features/teams/sub_canvas/libs/CanvasDragContext'` (the file has zero heavy deps). Optionally prune the barrel to type-only + genuinely external exports, since nothing else imports it.

## 2. Second, divergent PersonaAvatar implementation living inside teamConstants.tsx
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_canvas/libs/teamConstants.tsx:50
- **Scenario**: `teamConstants.tsx` defines its own `PersonaAvatar` (used by TeamToolbar, PersonaNode, AssistantMessages) while the canonical `src/features/agents/components/PersonaAvatar.tsx` exists. The canvas copy skips `resolvePersonaIcon`, so `builtin` and `custom` icon kinds (catalog ids, custom-icon asset ids) render as a raw emoji/text fallback instead of the actual image — exactly the renderer drift `resolvePersonaIcon.ts`'s doc comment says was previously fixed.
- **Root cause**: A React component was dropped into a "constants" lib file (forcing the `.tsx` extension) instead of reusing/extending the shared avatar; the two implementations have since diverged in icon classification and fallback behavior.
- **Impact**: Personas with builtin/custom icons look wrong on the team canvas vs everywhere else; any future avatar fix must be made twice. Also a structure smell: `teamConstants` mixes style constants, a helper, and a component.
- **Fix sketch**: Extend the canonical `PersonaAvatar` (it already supports size + fallback style; add a bordered-container variant if needed) and swap the three canvas call-sites to it; delete the local copy and rename the file back to `teamConstants.ts`. Verify the `size` container semantics (canvas copy wraps in a bordered box) before swapping.

## 3. useCanvasReducer hook (and the canvasReducer it wraps) has zero consumers — dead reducer stack kept alive only by the barrel
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_canvas/libs/useCanvasReducer.ts:14
- **Scenario**: Repo-wide grep finds `useCanvasReducer` only at its definition and the barrel re-export (index.ts:32); the barrel's sole consumer imports only `CanvasDragProvider`. `canvasReducer`/`initialCanvasState` in `canvasActions.ts` are in turn imported only by this hook, so the whole action/reducer runtime (~130 lines in canvasActions.ts plus this file) is unreachable.
- **Root cause**: The canvas presumably migrated off the reducer pattern (or never adopted it), leaving the hook and reducer behind; the barrel export masks the deadness from unused-export lint.
- **Impact**: Maintenance hazard — the reducer encodes canvas state semantics (saveStatus, contextMenu, ghostNode, reactFlowInstance) that no longer match the live implementation, misleading future readers; it also drags type-only `@xyflow/react` imports and dead exports through the barrel.
- **Fix sketch**: Delete `useCanvasReducer.ts` and the `canvasReducer`/`initialCanvasState`/`CanvasAction` machinery from `canvasActions.ts`, keeping only the type definitions that TeamToolbar still uses (`MemberWithPersonaInfo`, `StickyNote`, and `CanvasState` if referenced). Remove the corresponding barrel lines. Verification needed: confirm no dynamic/test usage outside `src/` (e.g. tests importing the reducer) before deleting.
