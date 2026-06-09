# UI Perfectionist — persona-chat-conversations
> Total: 6
> Severity: 0 critical, 3 high, 2 medium, 1 low

> Scope note: the prompt path `sub_editor/components/chat` does not exist. The real persona chat surface is `src/features/agents/components/ChatThread.tsx` + `ChatMessageContent.tsx` (chat turns, streaming, bubbles), with a parallel design-dialogue bubble in `src/features/agents/sub_design/components/ConversationMessageList.tsx`. This audit covers those.

## 1. Streamed assistant text and thinking state are silent to screen readers
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/agents/components/ChatThread.tsx:70-77, 82-96
- **Scenario**: A screen-reader user sends a message. The typing dots animate and the assistant reply streams in token-by-token, but nothing is announced — the user has no idea the persona is responding or what it said until they manually re-navigate the thread.
- **Root cause**: The streaming assistant bubble (`ChatMessageContent`, line 70-77) sits in a plain `<div>` with no `aria-live`. The thinking block (line 82-96) marks the animated dots `aria-hidden` and leaves the `thinkingLabel` in a static `<span>` with no live region. The streaming caret in ChatMessageContent.tsx:240-245 is also `aria-hidden`, so there is zero programmatic signal that output is in progress.
- **Impact**: inaccessible
- **Fix sketch**: Wrap the messages/streaming region (or at minimum the actively-streaming assistant bubble) in `aria-live="polite" aria-atomic="false"`, and give the thinking indicator `role="status" aria-live="polite"` with the label as accessible text (e.g. `<span className="sr-only">{thinkingLabel}</span>` alongside the visual dots). This mirrors the pattern already used by `InlineErrorBanner` (role/aria-live).

## 2. No auto-scroll or jump-to-latest affordance during streaming
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/agents/components/ChatThread.tsx:25-32
- **Scenario**: While a long reply streams, the user scrolls up to re-read an earlier turn. New tokens keep appending below the fold with no indication, and there is no button to return to the live edge. New messages can also land below the viewport without the thread scrolling to them.
- **Root cause**: `ChatThread` is a bare `overflow-y-auto` container that forwards its ref outward (`forwardRef`, line 25) and delegates 100% of scroll behaviour to a parent — but no caller wires that ref to scroll logic (the component is not consumed anywhere in-tree). There is no internal "is pinned to bottom" tracking and no floating "jump to latest" control, both standard for a streaming chat (the sibling companion feature ships `useChatScroll` + a scroll affordance).
- **Impact**: confusion
- **Fix sketch**: Add a small internal scroll hook: track whether the user is within ~80px of the bottom; auto-scroll on new content only when pinned; otherwise render a floating "↓ New messages" / jump-to-latest button (bottom-right, `absolute`) that re-pins on click. Reuse the existing `useChatScroll` pattern from `features/plugins/companion`.

## 3. Avatar + row markup duplicated four times; no shared bubble/avatar component
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/agents/components/ChatThread.tsx:35-47, 56-64, 83-86
- **Scenario**: Welcome, user message, assistant message, and thinking states each hand-roll the same `w-7 h-7 rounded-card ...` avatar chip and `flex items-start gap-3` row. Any tweak (size, color, ring) must be made in four places, and they will drift.
- **Root cause**: No `<ChatAvatar role>` or `<ChatRow>` primitive. The Bot avatar block (`bg-primary/10 border border-primary/20 ... Bot`) is copy-pasted at lines 36-38, 61-63, 84-85; the user avatar at 57-59; the row wrapper repeated at 35, 54, 83.
- **Impact**: inconsistency
- **Fix sketch**: Extract `ChatAvatar({ role })` and `ChatRow({ role, children })` (or a single `MessageBubble`) and render welcome/message/thinking through them. This also makes the design-dialogue bubble (finding 4) shareable.

## 4. User and assistant turns lack consistent visual hierarchy (no bubble, role-only avatar)
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/agents/components/ChatThread.tsx:65-77
- **Scenario**: User text and assistant text both render as plain paragraphs on the same background, differentiated only by a small avatar icon. There is no bubble fill, alignment, or label, so scanning who said what requires reading every avatar. Padding even differs (`pt-1` for user at line 66 vs `pt-0.5` for assistant at line 70), causing a subtle baseline misalignment between adjacent turns.
- **Root cause**: Neither role gets a container background or role label; the two branches use different top padding and the user branch is a raw `<p>` while the assistant branch is a wrapped markdown block, so they are not visually parallel.
- **Impact**: unpolished
- **Fix sketch**: Give the two roles a clear, consistent treatment (e.g. user turn in a subtle `bg-secondary/40 rounded-card px-3 py-2`, assistant plain on canvas, or vice-versa) and unify the top padding so consecutive turns align. Optionally add a quiet role label like the design-dialogue bubble does.

## 5. Two divergent message-bubble implementations for the same concept
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/agents/sub_design/components/ConversationMessageList.tsx:12-38
- **Scenario**: The design-dialogue history renders persona/user turns with a `rounded-full w-5 h-5` avatar, an info-colored AI chip (`bg-status-info/20 text-status-info`), an uppercase role label, and a relative timestamp — visibly different from the main chat thread's `rounded-card w-7 h-7` primary-colored avatar with no label/timestamp. The same "a person and an AI exchanging messages" concept looks like two different products.
- **Root cause**: `MessageBubble` (design) and the inline rows in `ChatThread` were built independently; avatar shape, size, color token (`status-info` vs `primary`), and metadata presence all diverge.
- **Impact**: inconsistency
- **Fix sketch**: After extracting the shared `ChatAvatar`/`MessageBubble` primitive in finding 3, render both surfaces through it (parameterizing density and whether a role label/timestamp shows). Standardize on one avatar shape and one assistant color token.

## 6. Error banner aligns via a magic `pl-10` indent
- **Severity**: low
- **Category**: polish
- **File**: src/features/agents/components/ChatThread.tsx:100-109
- **Scenario**: The failed-message error card is nudged under the message text column with a hard-coded `pl-10`. It currently lines up (avatar `w-7` = 28px + `gap-3` = 12px = 40px = `pl-10`), but the moment the avatar size or gap changes, the error card silently misaligns from every message above it.
- **Root cause**: The indent is a literal coupled to the avatar+gap geometry rather than derived from a shared spacing token or from reusing the row/avatar layout, with no comment explaining the 40px relationship.
- **Impact**: unpolished
- **Fix sketch**: Render the error inside the same `ChatRow` layout (empty avatar slot + content column) so alignment is structural, or replace `pl-10` with a named spacing constant shared with the avatar column width and document the derivation.
