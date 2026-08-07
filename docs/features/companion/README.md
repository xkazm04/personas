# Companion

Companion is the Athena assistant plugin. It has two UI surfaces: a plugin settings page and the always-available companion panel/footer affordance.

## User surface

| Surface | Behavior | Main files |
| --- | --- | --- |
| Plugin page | Three-tab manager for Setup, Memory, Voice | `CompanionPluginPage.tsx` |
| Setup | Global toggles such as footer icon visibility, chime, and beta self-improve exposure | `sub_setup/SetupPanel.tsx`, `companionPluginSlice.ts` |
| Memory | Full-page brain viewer over episodes, doctrine, identity, and constitution | `sub_memory/MemoryPanel.tsx`, `BrainViewer.tsx` |
| Voice | Engine picker (Kokoro / Pocket TTS) + per-engine voice setup | `sub_voice/VoicePanel.tsx`, `commands/companion/voice.rs` |
| Panel | Chat, streaming, quick replies, approvals, playback | `chat/` (see **Panel structure** below), `CompanionToolbar.tsx`, `ApprovalCard.tsx` |
| Avatar/footer | Athena's live video avatar **is** the footer button (left cluster, immediately right of the Network Settings icon) — tap opens/collapses the panel (or summons/hides the orb), **press-and-hold dictates a voice turn without opening the panel**. Avatar reflects state (idle/thinking/speaking); chime, pending playback, thread-attention badge. No text surface — see "Two dimensions" below | `AthenaAvatar.tsx`, `CompanionFooterIcon.tsx`, `chime.ts`, `voicePlayback.ts`, `useDictation.ts`, `companionStore.ts` (`voiceTurnRequest`) |

## Two dimensions: chat and orb

Athena communicates on exactly **two** surfaces, and nowhere else:

- **CHAT** (`chat/AthenaChatPanel`) — the full-information dimension. Everything she has
  to say in words lives here: replies, approval cards, proactive cards, the
  in-chat decision card, and the ledger of what she did without asking.
- **ORB** (`AthenaOrbLayer` + `OrbDecisionBubble` / `GuideCaption` / the orb's
  glow, captions, and avatar postures) — the quick-info and decision dimension.

There is deliberately **no third dimension**. Athena raises no toasts, no footer
notice popovers, and no corner pop-ups. Surfaces that used to do so, and where
their content went:

| Removed surface | Where it went |
| --- | --- |
| Footer notice popover ("Analysis completed" / proactive subject) | ORB state — the orb's one-shot message reaction on a finished turn, its `speaking` posture while an unread spoken reply waits, the footer Play button, and the thread-attention badge. The words are in chat. |
| "Athena auto-decided" fleet toast | ORB pulse + a durable in-chat ledger (`AthenaActionsStrip`, backed by `companionStore.athenaActions`). Backend `fleet_decisions` remains the audit trail. |
| Orb-decision failure toast | Rendered in place on the surface the user clicked — `decisionError` in `OrbDecisionBubble` and `ChatDecisionCard`. The decision stays pending, so the same chips are a retry. |
| Athena rows in the Channels live corner pop-ups | Filtered out at the `LiveChannelOverlay` sink; they still render in the Channels → Timeline. Other authors are unaffected. |

Because the orb is now a real dimension, the decision queue (`useDecisionQueue`)
is **always on** — it is no longer gated behind `companionHandsFreeDecisions` /
`companionAutonomousMode`, which now govern only how far Athena may act *without
asking*. And because `OrbDecisionBubble` cannot render while the chat panel is
open (there is no orb to dock against), `ChatDecisionCard` renders the same
pending decision inside chat under exactly the complementary condition — so a
pending decision of ANY source (approval, incident, human review, message
attention, ad-hoc) is always on one surface or the other, never neither.

## Footer avatar & hold-to-talk

The footer initiation control is Athena's actual animated avatar (`AthenaAvatar`), not a generic glyph — her idle/thinking/speaking video reflects what she's doing at a glance. The button has two gestures:

- **Tap** — opens/collapses the chat panel (the original behavior).
- **Press-and-hold** (≥220ms) — arms dictation; a mic badge + pulse appear on the avatar. On release, the final transcript is handed to the always-mounted `AthenaChatPanel` via the `voiceTurnRequest` store slot, which runs the standard `send()` pipeline. The reply streams and (when a voice engine is configured) auto-plays, surfacing through the orb's state change + the Play button — **all without the panel ever opening.** A hold's trailing synthetic `click` is suppressed so releasing doesn't also toggle the panel.

`voiceTurnRequest` is deliberately separate from `pendingPrompt`: `pendingPrompt` seeds the composer draft and is only consumed while the panel (and Composer) is mounted, whereas `voiceTurnRequest` is consumed by an always-mounted effect so a footer-initiated turn works with the panel closed.

**STT engine.** Both the footer and orb use the browser Web Speech engine (`useDictation`) via the shared `useHoldToTalk` hook; on WebView2 that forwards audio to the OS vendor's cloud STT. The mic is only ever armed by an explicit press, never on mount. A local, on-device Whisper STT engine (so audio never leaves the machine) is the separate workstream tracked in [`athena-orb-overlay-plan.md`](./athena-orb-overlay-plan.md) §4.

## Chat transcript & message UI

The panel body (`chat/AthenaChatTranscript.tsx` → `chat/AthenaChatMessageRow.tsx` → `Bubble.tsx`) is the primary reading surface and carries most of the chat-window polish:

- **Bubbles & grouping.** Assistant turns sit on a defined surface (tint + hairline border + faint elevation) with a small static Athena avatar in the gutter; user turns are right-aligned with a primary tint. Consecutive same-role messages **group** — only the first shows the avatar, the rest align under it with tightened spacing (`groupStart`/`groupEnd` computed in the panel map).
- **Per-message hover actions.** Hovering (or focusing) a message reveals a copy button (shared `CopyButton`, copies the clean markdown source) and a live relative timestamp (shared `RelativeTime`). The row uses a `grid-rows` 0fr→1fr collapse so it adds zero height when idle and never shifts layout.
- **Welcome hero.** An empty transcript shows `WelcomeHero` — Athena avatar + greeting + starter-prompt chips that fire real messages through `send()`. The chips reuse the translated slash-palette presets.
- **Guided empty states.** The Decisions panel and the Brain Viewer's per-kind list both render the shared `feedback/EmptyState` primitive (icon + title + hint) with an actionable CTA instead of a dead text block — mirroring the launchpad feel of `WelcomeHero`. Decisions offers **Ask Athena to log a decision** (seeds the chat with a first-person opener via `setPendingPrompt` + `autoSend` and opens the panel); a filtered-empty list shows the shared `NoResults` reset instead. The Brain Viewer's CTA is kind-aware: `reflection` runs `companion_run_reflection` and jumps to the new entry, fact kinds kick off `companion_run_consolidation` (toast points at the Memory-tab review), and every other kind opens the chat seeded with a "help me add the first entry" prompt.
- **Streaming state — one surface, not four.** The streaming bubble shows a single generic label ("Working…") paired with animated `TypingDots`, with the **Stop reply** control sitting inline right beside the dots. That is deliberately all there is: a CLI turn used to report itself in four places at once (a phase label naming the live tool, the narration timeline live log, an activity-tray task per slow tool, and the plan checklist), which turned "she's thinking" into a scrolling machine readout. The only detail that survives is the `OperationalThread` checklist, because a TodoWrite plan is HER plan for the user's request rather than a transcript of her tooling. Athena's own `PROGRESS:` beats still outrank the generic label — those are authored prose. The slow-progress hint chip still appears after 30s/2min of CLI silence. Reduced motion holds the dots static. `NarrationThread.tsx` and the narration store slices are intact and still feed the turn sidecar + the dev conversation-log export; they are simply no longer mounted in chat.
- **Narration trail (recorded, not rendered).** The narration timeline is still built and promoted onto each assistant episode (`narrationByEpisodeId`) and persisted in the turn sidecar, so the dev conversation-log export keeps every tool call with its duration. The collapsed **"What I did — N steps · 48s"** disclosure under the completed bubble was **retired from the chat** in the same pass that reduced the streaming turn to one surface — a per-turn tool inventory is developer telemetry, not conversation. `NarrationTrail` remains in `NarrationThread.tsx` if it is ever wanted back. See [`conversation-orchestration.md`](./conversation-orchestration.md) (D2).
- **Bottom-aware autoscroll.** `useChatScroll` keeps the transcript pinned to the bottom only while the user is already there; once they scroll up to read history, new content stays put and a floating **Jump to latest** pill appears. Soft top/bottom scroll-fade masks (`companion-scroll`) dissolve messages into the panel chrome at the edges.
- **Markdown rendering.** Athena's replies render through the shared `MarkdownRenderer` scoped to the chat via `className="athena-chat-md"` + the opt-in `codeBlockActions` prop (other call sites are unaffected). This gives: code blocks with a language-label header + copy + line-wrap toggle + collapse for blocks over 16 lines; a palette-tuned syntax-highlight theme (with a light-theme variant); styled GFM task-lists and zebra-striped tables; external-link affordances; and the inline `chart` bar block. The same treatment is reused inside `ConnectorCallCard` results and `ApprovalCard` params.
- **Day separators.** A centered date chip (Today / Yesterday / locale date) marks the first message of each new calendar day.

### Panel structure (`chat/`)

The chat window lives in `src/features/plugins/companion/chat/` — one component
or helper per file, none over 200 lines, named `AthenaChat<Component>.tsx` /
`athenaChat<helper>.ts`. `AthenaChatPanel.tsx` is the default export App mounts.

| File | Owns |
| --- | --- |
| `AthenaChatPanel.tsx` | The always-mounted shell: geometry, orb→chat morph, header, tool strips |
| `athenaChatShell.ts` | Effects that must run with the panel **closed** (approval reconcile, `explain_in_cockpit`, beta flags) |
| `AthenaChatBody.tsx` | Layout of the open panel — markup only |
| `athenaChatSession.ts` | All the wiring: voice, send, queue, stream, events, navigation, hydration, scroll, window |
| `AthenaChatTranscript.tsx` / `AthenaChatMessageRow.tsx` | The message list and one `memo`'d row |
| `AthenaChatStreamingTurn.tsx` | The in-flight bubble, typing dots and inline Stop |
| `athenaChatStream.ts` / `athenaChatDeltas.ts` | The `companion://stream` listener and per-frame token coalescing |
| `athenaChatSend.ts` / `athenaChatQueue.ts` | One turn end-to-end, and the interrupt-vs-queue front door |
| `athenaChatVoice.ts` / `athenaChatAudio.ts` | Spoken ack/heartbeat/beats, and the two exclusive audio channels |

The orb got the same treatment. `orb/AthenaOrb.tsx` is now a shell over `athenaOrbGeometry` (fractions ⇄ pixels, viewport, dock side), `athenaOrbGesture` (tap / hold-to-talk / drag-and-snap), `athenaOrbPresence` (posture, counts, caption, aria label), `athenaOrbReactions` (the one-shot message + forward-ack pulses), `athenaOrbGlow` (the imperative audio-reactive bloom) and `AthenaOrbDecor` / `AthenaOrbCornerActions` for the visuals — every file under 200 lines. `OrbDecisionBubble` has not been split yet and is the one file in `orb/` still over.

**Render pressure is the reason for most of the shape.** The panel this replaced
subscribed to `streamingText` at the top and threaded ~25 props into a single
`Body`, so every animation frame of a reply re-rendered the whole transcript —
every mounted `MarkdownRenderer` with it. Three rules keep that from coming
back: nothing subscribes to `streamingText` with a selector; `AthenaChatMessageRow`
is `memo`'d and takes only primitives, store objects and `useCallback`s (job
cards and the last-turn actions read their own state precisely so the row stays
memo-clean); and per-tick surfaces (the slow-progress chip, the a11y live
region, job cards) own their own subscriptions so their ticks re-render
themselves rather than the body.

**Transcript window.** Only the last **10 rounds** are mounted — a round being
one user message and everything Athena said in reply, so a cut never orphans a
reply from its question (`athenaChatWindow.ts`). Older messages stay in the
store (search, export and Athena's own memory are unaffected) and come back on
demand: the user clicks the "N earlier messages" divider, or simply scrolls to
the top, and the window grows a page at a time. Every expansion is
scroll-anchored (`athenaChatEarlier.ts`) so the reading position doesn't jump.
Only once everything loaded is on screen does `useTranscriptPages` take over and
fetch genuinely older rows from the backend — two mechanisms, one gesture.

**Geometry** (`athenaChatGeometry.ts`). The panel is anchored `bottom-12` (48px
above the viewport floor) and the custom title bar is a fixed 48px band, so the
max height is `100vh − 112px`: bottom inset + title bar + 16px of breathing
room. The previous `max-h-[calc(100vh-5rem)]` put the panel's top edge at y=32
on a tall window — 16px *inside* the app header. Expanded width is **912px**
(20% wider than the original 760px); compact stays **350px**, since compact
exists to give the screen back. Width is animated by motion rather than a CSS
`transition-[width]`, so resizing shares one easing curve with everything else
the panel does.

**Compact mode is chat and nothing else.** The `CompanionToolbar` rail and the
inner Fleet side panel are both hidden when compact — the rail is replaced by a
20px `AthenaChatCompactHandle` carrying the same expand arrow and the same
`companion-toggle-compact` testid. Show/hide of the tool strips and the side
panel goes through the shared `Collapse` primitive (`unmountWhenClosed`), so
they fold instead of blinking and nothing keeps polling behind a shut row.

**`[canvas]` system episodes.** When Athena steers the Mastermind canvas,
`companion_canvas_control_result` appends the settled `CanvasActionResult` as a
System episode so she can read on her next turn where the camera ended up. That
episode is written for *her* — a JSON envelope of camera coordinates, a zoom
band and island uuids — and the transcript used to render it verbatim. The body
is unchanged (it is her memory; trimming it would blind her), but the chat now
parses it (`athenaChatCanvasSummary.ts`) and renders a one-line human note
instead: "Travelled to a project on the canvas — close view · 14 projects in
view", or, on a refusal, "Couldn't steer the canvas — the view was zoomed too
far out". A truncated envelope still yields the action name.

### System messages — the app's own voice

`role: 'system'` covers four unrelated things, and the transcript used to render
all of them as assistant-shaped bubbles: Athena's avatar beside text she never
wrote, machine notes at the same visual weight as an answer. They are now split
(`systemMarkers.ts` + `chat/athenaChatSystemKind.ts`):

| Kind | Example | Rendering |
| --- | --- | --- |
| **Marker** | `[autonomous continuation #3]`, `[Fleet]`, `[proactive: …]` | Slim divider (`Bubble`); `proactive` renders nothing at all |
| **Canvas readback** | `[canvas] Result of your \`canvas_control\` (…)` | One-line human summary (`AthenaChatCanvasNote`) |
| **Tagged note** | `[dispatcher] Your last \`OP: …\` was rejected…` | `AthenaChatSystemNote` — "Action blocked" |
| **Operation record** | `fleet-orchestration op:… state:… intent:…` | `AthenaChatSystemNote` — "Fleet operation", correlators demoted to a meta line |

`AthenaChatSystemNote` reads as a **margin note**, not a reply: a hairline accent
rail down the left, a small Title-Case label naming what produced it, and the
body set as real markdown — which is the point, since these rows carry bullet
lists and inline code (`OP: use_connector{…}`) that a plain paragraph destroyed.
Notes past ~260 characters clamp behind a fade with a "Show more" toggle: the
dispatcher's rejection note is several sentences of instruction addressed to
Athena, and the user should not have to scroll a briefing to reach the next
message. Nothing is ellipsized — the fade says there is more, the button opens it.

**No shouting.** Every all-caps label in the companion is gone. Removing the
Tailwind `uppercase` class was only half of it: the `typo-label` token itself
carries `text-transform: uppercase`, so surfaces using it ("ATHENA NEEDS A
DECISION", the side-panel header) still shouted afterwards. Those now use
`typo-caption` + a weight bump, which holds the same visual rank without the
volume. Verified live: zero elements with a computed `text-transform: uppercase`
inside the chat panel or the orb layer.

**Markdown at chat scale** (`globals.css`, scoped to `.athena-chat-md`). The
shared renderer is tuned for full-width documents — an `h1` is `typo-heading-lg`
with a rule under it, top margins run `mt-10/8/6` — which inside a reply column
reads as a banner and pushes the answer below the fold. The chat now compresses
the scale and carries hierarchy through weight and colour: h1/h2 at foreground
weight 650, h3/h4 at body-plus-a-notch in a primary-tinted hue, no rule under
h1, tighter paragraph and list rhythm, inline code that doesn't grow its own
line box. Measured live at the app's "large" text scale: **17 / 16 / 15 px
headings over 14px body, 12px inline code**.

> **Watch the specificity.** These heading rules use a DOUBLED class
> (`.athena-chat-md.athena-chat-md h1`). The app's text-size preference overrides
> the typography tokens through `[data-text-scale="large"] .typo-heading-lg` — an
> attribute+class selector at (0,2,0) that outranks a plain `.athena-chat-md h1`
> at (0,1,1). Without the bump the chat h1 quietly stayed at document scale while
> every other rule in the block applied, which is exactly the bug the block
> exists to fix.

### Opening the window — two-phase mount

Opening the chat used to mount the whole interior inside the frame that was
simultaneously flying out of the orb and scaling from 18%. Measured warm on an
EMPTY conversation, the frame did not paint for **334ms**, with **257ms** of
blocked main thread inside that — the morph had no frames to animate with,
which is what the operator felt as lag.

The frame now paints first and fills afterwards, in two waves
(`chat/athenaChatMount.ts`):

| Wave | Carries | Lands |
| --- | --- | --- |
| Frame | Panel chrome, header, `AthenaChatSkeleton` | ~1 frame |
| `ready` | Transcript, alerts, proposals, composer | After the morph |
| `chromeReady` | Toolbar rail, Fleet side panel, video watermark | 2 frames later |

Measured after, median of settled warm opens: **frame at 18ms** (from 334ms),
longest single task **94ms** (from 155ms), worst frame **111ms** (from 192ms).
The remaining work happens once the window is up and still, so it no longer
stutters the animation.

**The gate is a timer, and that is deliberate.** Two more elegant designs were
tried and measured away first: `onAnimationComplete` and a bare double-`rAF`
both collapsed back into a single ~130ms block with the skeleton never
rendering, because the app forces `reducedMotion="always"` whenever the window
is backgrounded and framer then completes the animation inside the very task
that mounted the frame. So the gate waits out the morph's own declared duration
(`usePanelMotion().settleMs` — 280 / 180 / 120ms) and then takes two painted
frames on top.

**Nothing behind the gate listens.** That is what makes staging safe, and it
required moving the session's listening half out of the open-only body first —
see below.

### The engine is always mounted (`chat/athenaChatEngine.ts`)

The send pipeline, the `companion://stream` listener, navigation, guide steps,
chat cards, approvals, proactive deliveries and the `voiceTurnRequest` consumer
all used to live inside the body, which exists only while the window is open.
Three surfaces exist *because* the window is shut — hold-to-talk on the footer
avatar, the orb's quick-input bar, and "Ask Athena" forwarded from a dashboard —
and every one of them parks its message in `voiceTurnRequest` for a consumer
that was not there. **Verified before the fix: with the panel minimized, a
`voiceTurnRequest` sat unconsumed and no turn ever ran.** Several doc comments
claimed otherwise; they were describing the component file, which is always
mounted, not the effect inside it.

`athenaChatShell.ts` was the same bug caught twice before and patched one effect
at a time (the approval reconcile; the orb's `explain_in_cockpit` flow, after QA
hit it on 2026-06-10). Hoisting the engine applies that fix to the rest of it,
and as a side effect the transcript is hydrated app-wide — which is what the
orb's quick-input bar reads for its last reply, so that surface no longer waits
for the panel to have been opened once.

Verified live with a real turn: panel minimized, request consumed, turn
streamed, the reply landed, and the orb raised its badge with the reply's text
as the unread preview.

### Inner side panel

`CompanionSidePanel` is the reusable inner dock between the chat column and the
outer toolbar rail. Three fixes worth remembering, all of them structural:

- **Always full height.** It used to size to its content, so a quiet fleet left a
  stub of a panel floating against the chat's full-height column with the border
  stopping halfway down. `self-stretch h-full` makes it read as part of the
  window frame at any content length. It is deliberately NOT wrapped in the
  shared `Collapse` primitive — that animates height (the grid `0fr→1fr` trick),
  which is the wrong axis for a side rail and, by sizing the child to a grid row,
  defeats the stretch outright.
- **The toggle handle escapes the panel's clip.** The handle straddles the
  panel's left border, and a shared `overflow-hidden` on the same element that
  positioned it clipped the outer half away — leaving a half-moon that read as
  sitting *behind* the chat column. The clip now lives on the inner body; the
  rail itself is `overflow-visible` and `z-20`. Verified live with
  `elementFromPoint` at the handle's own centre.
- **A session row opens its terminal.** Clicking a row raises the app-wide fleet
  grid focused on that session (`fleetSetActiveSession` + `fleetSetGridOpen`)
  rather than growing a second terminal host. The chat panel already lifts itself
  to `z-[220]` above that overlay, so the conversation stays readable the whole
  time — glance at the terminal, hit Back (or Escape), keep talking. The
  "no sessions tracked" line is gone: the count above it already says zero.

### Unread replies on the orb (`orb/OrbUnreadBubble`)

The orb could already tell you that N replies landed while the chat was closed.
A count is a poor signal — it says something happened without saying whether it
can wait, so the only way to triage was to open the chat, which is the exact
interruption the minimized presence exists to avoid.

The reply itself now docks above the orb: the newest unread message rendered as
markdown (short, word-boundary trimmed, never mid-word), a **read-aloud** control
for hearing it again when a voice engine is configured, and **Open chat**.
Dismiss means *mark as read*, not *hide* — leaving the badge up after the user
has read the words here would make it lie.

`companionStore` gained `unreadPreview` beside `unreadReplies`, plus
`setUnreadPreview` for the common case where the badge is raised before the
reply's words arrive (a transcript refetch resolving a beat later). It no-ops
when nothing is unread, so a slow refetch can never resurrect a preview for a
message already read. Callers that have no text — a background thread's turn,
which never refetches a transcript the user isn't looking at — omit it and the
prior preview is kept.

**It defers completely to the decision bubble.** A decision is a question
addressed to the operator and a message is news, so while `pendingDecision` is
set this stays down and returns the moment it clears. Both share one docking
geometry (`orb/athenaOrbDock.ts`) so they can never drift a few pixels apart and
start looking like two different components. *(Note when testing: the decision
queue is always on, so in an app with real pending incidents the unread bubble is
legitimately invisible — stub `setPendingDecision` to observe it in isolation.)*

### Attention bar — two levels instead of six stacks

Six independent surfaces used to pin themselves above the transcript unconditionally: MCP pending requests, the chat decision card, assignment cards, the autonomous-actions ledger, and one full `ProactiveCard` per nudge. On a busy day that pushed the actual conversation off screen, which is the opposite of what a chat window is for.

**Level 1** is `attention/AttentionBar.tsx` — a single row of count chips, one per kind that currently has anything in it, and nothing at all when Athena is quiet. **Level 2** is the cards themselves, rendered only when their chip is toggled on.

| Chip | Covers | Default |
|---|---|---|
| **Waiting on you** (`blocked`) | pending MCP requests + the pending decision | **expanded** — a spawned CLI session is parked until it is answered |
| **Failures** (`errors`) | nudges with `fleet_failed` / `fleet_stuck_dispatched` / `incident_blocker` / `backlog_aging` | collapsed |
| **Warnings** (`warnings`) | `fleet_awaiting` / `fleet_stale` / `goal_target_approaching` / `execution_review` | collapsed |
| **Athena reached out** (`nudges`) | every other proactive kind (digests, scheduled check-ins, completed ops) | collapsed |
| **Assignments** (`assignments`) | `CompanionAssignmentCards` | collapsed |
| **Acted for you** (`activity`) | `AthenaActionsStrip` | collapsed |

The severity split lives in `attention/attentionKinds.ts` (`nudgeSeverity`), mirroring the accent colors `ProactiveCard` already paints per trigger kind, so a chip and the card it reveals always agree; an unmapped kind falls through to informational rather than inventing urgency. `message_attention` rows stay uncounted and unrendered — they are already aggregated onto the `message_digest` card. Counts come from `useAttentionCounts()`, which reads the same stores the level-2 surfaces read.

**The expansion set is persisted** (`companionAlertsExpanded` in the system store's partialize list), so whatever shape the user settles on survives a panel reopen and an app restart. `LiveOpsStrip` sits above the bar and keeps its own independent collapse; approval cards still render inline on the turn that produced them.
- **Header actions & search.** The header carries a **search** toggle (opens an in-transcript find bar — `ChatSearch` overlays matching messages with a live count, backed by `chatSearchOpen`/`chatSearchQuery` in the store) and a **copy-conversation** action (serializes the transcript to role-labeled markdown via the shared `CopyButton`).
- **Failed-turn retry.** When a send errors, the error chip offers a Retry that re-sends the last user message.
- **Autonomous mode** gives the panel a breathing primary border (`companion-autonomous`) and rings the header avatar so a self-driving Athena is unmistakable.

The connector/schedule/event pickers open through `ComposerPickerShell`, which portals to `document.body` so it's never clipped by the panel's blur/transform/overflow, and is viewport-responsive (grid scales 2→3→4 columns, panel up to 88vh).

## Floating dockable orb (`minimized` state)

Step 2 of [`athena-orb-overlay-plan.md`](./athena-orb-overlay-plan.md) promotes Athena out of the footer into a first-class overlay. A new `CompanionState` value `minimized` (between `collapsed` and `open`) shows `AthenaOrb` — her avatar as a draggable orb portal'd to `document.body` above all app content (`orb/AthenaOrbLayer.tsx`, `orb/AthenaOrb.tsx`).

- **One pointer surface, three gestures:** tap → open the full chat panel; hold (≥220ms) → dictate a voice turn (via the same `useHoldToTalk` → `voiceTurnRequest` path as the footer); drag past ~6px → relocate. A drag cancels an armed hold so moving never records. While listening, the interim transcript shows as a caption beside the orb.
- **Dock + persistence:** on drop the X position snaps to the nearest side edge; position is stored as viewport fractions (`companionOrbPos`) and resolved to pixels at render so it survives window resizes and restarts. A hover-revealed `×` dismisses the orb (→ `collapsed`).
- **Footer + panel wiring:** when the orb is enabled (`companionOrbEnabled`, default on, toggled in Companion → Setup → "Floating avatar"), the footer button summons/hides the orb (`minimized ↔ collapsed`) and the chat panel's close button returns to the orb instead of vanishing. `AthenaOrbLayer` promotes a dormant (`collapsed`) Athena to `minimized` once on mount so the presence is there from launch. With the orb disabled, the footer keeps its classic open/collapse behavior.
- **Quick-input bar:** a small `Keyboard`-icon affordance on the orb (`orb/OrbQuickInputBar.tsx`) toggles a compact bottom bar for a whole exchange with Athena without opening the chat panel. It submits through the same `voiceTurnRequest` bridge as hold-to-talk, so it runs the identical `send()` pipeline (streaming, transcript persistence, TTS).
  **The reading half is the point of the surface**, and it used to be an afterthought: the reply was a three-line clamp of raw text, so a structured answer arrived as a wall with its ending cut off and the only way to see the rest was to open the very window the bar exists to avoid. It is now a real reading surface — **50% wider** (`max-w-xl`), rendered as markdown through the same `athena-chat-md` scale the panel uses, at reading size rather than caption size, sized to its content and scrollable past **38vh**. The governing rule is *a paragraph fits without scrolling and anything longer scrolls rather than truncating*; nothing here ends in an ellipsis. A new reply resets the scroll to its own beginning, the header carries a read-aloud control and an expand-to-chat button, and an in-flight turn shows typing dots instead of a stale answer.
  The composer is the slim `size="sm"` + `voice` variant of the shared `ChatInputBar` (`shared/components/forms/ChatInputBar.tsx`) in its new opt-in **`multiline`** mode: an auto-growing textarea (Enter sends, Shift+Enter newlines, capped at 6 rows then scrolls) so a paragraph can be written as well as read. Studio's build chat wraps the same component and is untouched — `multiline` is off by default.

**Polish (Step 2b).** Opening from the orb morphs the panel out of the orb's position (it flies + scales from the orb's recorded center, anchored to the panel's bottom-left corner, and collapses back on close). A global **Cmd/Ctrl+Shift+A** summons Athena and starts a voice turn (press again to send, **Esc** to cancel — the shared `useHoldToTalk` instance lives in `AthenaOrbLayer` so the orb and the keyboard drive one session). All of it honors `prefers-reduced-motion`.

**Audio-reactive glow.** While Athena speaks, a bloom behind the orb pulses with her actual voice level. `voicePlayback.play()` routes every TTS `<audio>` through a single shared `AnalyserNode` (`audioLevel.ts`); the orb subscribes via `subscribeAudioLevel` and drives the glow's opacity + scale imperatively in a `rAF` callback (no per-frame React re-renders). The tap is best-effort — if Web Audio is unavailable it silently degrades and playback is unaffected. Under `prefers-reduced-motion` the glow is a static bloom (no subscription).

**Message reaction.** When a reply finishes (streaming `true → false`), the orb bumps a `messageNonce` that `AthenaAvatar` consumes to play a one-shot `athena_message_loop.mp4` clip: it crossfades in immediately, plays one loop (~10s, raises arms and back), then reverts to the sticky state. For that one loop the orb border glows in the theme `primary` colour (the avatar fires `onMessageActiveChange(true/false)` at clip start/end so the glow lasts exactly one loop). No-op under `prefers-reduced-motion`.

**Avatar resource discipline (`AthenaAvatar`).** The footer + orb videos are a nice-to-have in a tiny space, so: only one clip plays at a time (others paused at frame 0); **playback pauses whenever the document is hidden** (`visibilitychange`) and resumes on return — zero decode while backgrounded; and under `prefers-reduced-motion` **no `<video>` mounts at all** — just the static poster (`athena_baseline.jpg`), so reduced-motion users pay no decode and get no animation. Clips are 320×320 / 12fps / CRF 30 / no-audio ping-pong (~110–160 KB), hardware-decoded.

**Orb progress dots (async-UX phase 3).** While background tasks run, the minimized orb grows up to 5 pulsing dots arced across its top perimeter — one per in-flight task (queued + running, from `jobsById`). The orb also borrows the `thinking` avatar posture so a working Athena reads as active even with the panel minimized, and its `aria-label` announces the count ("2 tasks running"). The dots vanish as tasks complete. This is the minimized-state twin of the activity tray: tray when open, dots when minimized.

## Guided walkthroughs (orb choreography + element glow)

Athena can *show* the user how to do something instead of only telling them: her orb glides to each key area of the screen, the relevant element glows (a non-dimming accent ring — the rest of the UI stays visible and clickable), and she narrates each step in a caption beside the orb. This is driven by a reusable engine — a topic-keyed registry of declarative steps (`guidance/walkthroughs.ts`), a runner (`guidance/useGuidanceRunner.ts`) that walks them, the `AthenaGuideGlow` ring + `GuideCaption` (hosted by `AthenaGuideLayer`), and the orb's programmatic glide (an ephemeral `orbGuideTarget` in `companionStore`). The element-tracking core (`useTrackedElementRect`) is shared with the onboarding `TourSpotlight`.

When a user describes a persona they want, Athena offers both paths via `show_persona_creation_offer` — a card with **Build it for me** (the prefill / one-shot handoff) and **Show me how to build it** (`start_guided_walkthrough { topic: "persona_creation" }`). The first walkthrough rings the build studio, its sigil compose trigger, and the autonomous toggle. New ops are taught in constitution **v19**; topics are allow-listed in `dispatcher.rs` (`GUIDED_TOPICS`). Full design + the "how to add a walkthrough for any surface" recipe live in [`athena-guided-walkthroughs.md`](./athena-guided-walkthroughs.md).

**Generalized offer (`show_walkthrough_offer`, E3, constitution v36).** The persona-creation offer is hard-wired to one topic; `show_walkthrough_offer { topic, summary? }` generalizes it to ANY allow-listed walkthrough — a `walkthrough_offer` chat-card (`WalkthroughOfferWidget`) with **Show me** (starts the tour via `startGuidance`) and **Just tell me** (seeds a chat explanation via `setPendingPrompt` + `autoSend`). It's the default response to "how do I X" when a walkthrough covers X; `topic` is validated against `GUIDED_TOPICS` and invalid ones are dropped. The backend anchor allow-list is now code-generated from `guidance/anchorCatalog.ts` (E1) so growing walkthrough coverage no longer needs a manual TS↔Rust sync.

**Coverage expansion (E2, constitution v39).** The registry grew from two topics to six, adding `trigger_creation` (Events → Builder), `template_adoption` (gallery → Adopt), `incident_triage` (Overview → Incidents inbox), and `goal_kpi_setup` (Teams → Goals → KPIs). Sub-tab switching is handled by four new closed-enum `preAction`s (`open_trigger_builder` / `open_overview_incidents` / `open_goals_board` / `open_kpi_dashboard`); the incident detail modal is narrated, not ringed; and every topic's first step rings an always-present route container so a missing data-dependent target (an incident row, a goal card) degrades to narration-only rather than hanging. Full topic table + recipe in [`athena-guided-walkthroughs.md`](./athena-guided-walkthroughs.md).

## Athena desktop-aware lineage

Companion's awareness of the user's desktop activity ships in phases. The decision-gate audit lives at [`../../architecture/athena-phase1-audit.md`](../../architecture/athena-phase1-audit.md); the two shipped feature deliverables sit alongside this README:

- [`athena-daemon-bridge.md`](./athena-daemon-bridge.md) — Phase 3 c v3. Cross-process `ambient_signal` SQL projection so daemon-fired personas see the same in-memory ambient window the windowed app captures (clipboard, app focus, file changes).
- [`athena-cli-session-awareness.md`](./athena-cli-session-awareness.md) — Phase 5 v1. Read-only injection of the user's active interactive Claude CLI session into a persona's prompt, gated by per-persona toggle (Settings tab) AND global toggle (Companion → Setup → Sensory signals).

## Initialization and brain storage

`companionInit()` calls `companion_init` once per browser lifetime using a `globalThis` promise slot so StrictMode and Vite HMR cannot double-ingest doctrine. The backend initializes `~/.personas/companion-brain/` and starts doctrine ingestion in the background when the `ml` feature is available.

Manual re-ingest uses `companion_reingest_doctrine`. It is idempotent: unchanged chunks are skipped by content hash, and the frontend receives inserted/updated/unchanged/deleted counts.

## How recall picks what Athena sees each turn

Three lanes feed the per-turn memory bundle (`companion/brain/retrieval.rs`):

| Lane | Needs | What it contributes |
| --- | --- | --- |
| **Keyword (BM25)** over `companion_fts` (`brain/keyword.rs`) | nothing — runs in every build | Doctrine chunks, older episodes from this conversation, facts and procedurals that match the question's terms |
| **Vector (KNN)** over `companion_embedding` | the `ml` feature + a configured embedder | Semantically related nodes, unioned on top of the keyword lane |
| **Always-include tiers** | nothing | Top facts + procedurals by importance, active goals, open backlog — deliberately query-independent, so Athena's picture of who you are doesn't depend on phrasing |

Two properties are load-bearing:

- **Recall varies with the question.** Ask about two different topics and you get two different bundles. Previously the shipped build (which has no `ml` feature) returned the same most-recent episodes and the same top facts on every turn, and the Reference/doctrine section was *always empty* — the 400+ indexed doctrine chunks were never consulted. The keyword lane is what makes doctrine reachable without an embedder.
- **An off-topic question gets no filler.** Both lanes can return *empty* rather than padding the prompt with the least-irrelevant rows: the vector lane has a distance floor, the keyword lane drops stopword-only queries and matches nothing when no term hits.

The episode window is a **budget, not a per-lane quota** — query-relevant older turns first, then a recency tail sized to fill whatever is left, so a lane that finds nothing can't shrink the window.

## Identity layer (`identity.md`, F1 — direction 7)

`~/.personas/companion-brain/identity.md` is the evolving profile of the user (and Athena's self-model), read into **every** system prompt by `prompt.rs`. It grows by **anchored diffs**, never a whole-file rewrite: the engine in `src-tauri/src/companion/brain/identity.rs` parses the doc into sections (`# heading / ## heading` path) and applies `AppendBullet` / `ReplaceBullet` / `RemoveBullet` against one bullet under a named section, leaving the rest untouched.

- **Athena's writes** go through the `update_identity` op — **approval-gated and never auto-approved** (deliberately absent from `AUTOAPPROVE_ALLOWLIST`, like `update_dev_goal`). Two param modes: `diffs: [{section, op, anchor_text?, new_text?, rationale}]` (≤5, the preferred incremental path — each bullet should cite its source episode ids; structurally validated in `dispatcher.rs`, anchor-existence checked at execute time with partial-failure reporting) and `content: "..."` (a full rewrite, reserved for the intake first draft). `execute_update_identity` (`approvals.rs`) backs up the prior file (`identity.bak-<ts>.md`) before every write and bumps the `updated` frontmatter. Constitution **v37** teaches the op + the discipline (evidence-only, one focused diff, never journal).
- **The user is editor-of-record.** The Memory-tab BrainViewer renders the identity DetailView with an **Edit** affordance (textarea over the raw markdown → `companion_save_identity`, full write + backup) — the user can rewrite it wholesale, bypassing the diff machinery by design.
- **Intake interview (F2).** The full first-conversation interview runs automatically on a fresh install (`prompt.rs::onboarding_addendum_if_needed` detects placeholder identity + no episodes and injects an ONBOARDING MODE block that ends in an `update_identity` proposal). It's also **re-runnable anytime** — a "Get to know me" `WelcomeHero` chip + a `/intake` slash preset seed the request, and constitution **v38** teaches Athena to run the same short interview on demand (anchored `diffs` when identity already has content, `content` for a fresh draft).
- **Behavioral synthesis (F3).** Athena also learns from what the user *does*. A weekly, gated (`companion_profile_synthesis`, default off), deterministic pass (`brain/profile_synthesis.rs`, run from the proactive tick) gathers **statistics only** — proactive engage/dismiss rates by kind, refine-chip variant counts, walkthrough completion, voice-vs-text ratio, approve/reject rates by op — from `companion_turn` (A1), `companion_proactive_message`, `companion_approval`, and a new `companion_ux_signal` table (lightweight frontend instrumentation: refine chips, walkthrough completion/abort, hands-free decision usage, recorded via `companion_record_ux_signal`). One cheap headless `cli_text` call proposes **≤3 evidence-cited `update_identity` diffs** (each citing the statistic that justified it; zero is the expected common case), which land as a normal approval card — same review path, no new UI. Numbers-only input + the approval gate keep it from over-reaching.
- **Spend the profile (F4).** The profile must visibly change behavior or it's dead weight. Three ways it does: (1) **Budget modulation** — `proactive/budget.rs` adjusts each per-kind attention cap by ±1 from 30-day engagement (dismissed ≥80% → −1, engaged ≥60% → +1, n≥5, within bounds), so a kind the user reliably dismisses gets quieter on its own. It only changes card *frequency* — never the message-triage safety floor (high/urgent/critical) or the global ceiling. (2) **Transparency** — `companion_get_adaptations` surfaces the active modulations as a "What Athena adapts" caption in the identity DetailView. (3) **Correction loop** — a per-bullet **"That's wrong"** affordance (`companion_correct_identity_claim`) records a correction episode (feeding Athena's "What I've gotten wrong" self-model) and proposes a one-click `RemoveBullet` approval — corrections are the highest-value profile signal, so they're one click.

## Conversation flow

1. Frontend sends `companion_send_message` with the user message and a `voiceEnabled` flag.
2. Backend drives the companion runtime and streams progress through `companion://stream`.
3. Final response returns user/assistant episode IDs, quick-reply labels, and optional `ttsText`.
4. The panel appends messages to `companionStore.ts`; pending playback is stored globally so the footer Play button and chat panel coordinate.
5. `companion_reset_conversation` clears the persistent Claude CLI session and can optionally wipe the SQL transcript. Markdown episodes remain on disk.

## Multiple conversations (threads)

Athena runs **many conversations at once — one mind, many threads.** Each conversation has its own transcript, its own Claude `--resume` continuity, its own turn lock, and its own recency lane; the brain (facts/goals/procedurals/doctrine/identity), the Task pool, and the proactive economy stay **global**, which is what keeps her a single Athena across every thread. Full design: [`athena-multiconversation.md`](./athena-multiconversation.md).

**Switcher (chat window).** The header shows the **active thread's title as a dropdown** (beside Athena's avatar, which carries the identity). The menu lists every conversation with a status dot — ● *awaiting you* (unread reply), ◐ *working* (a turn is live), ○ *idle* — plus its unread count, **rename- and archive-on-hover** affordances (rename any thread inline — a pencil turns the title into an edit field; archive is offered for non-system threads only), and **New conversation**. Switching a thread swaps the transcript to that thread's slice and marks it read; the brain stays shared. Rendered by `ConversationSwitcher.tsx`; the active thread + registry live in `companionStore.ts` (`conversations`, `activeConversationId`, `useActiveConversation()`).

**System threads.** Two are always present and can't be deleted (only archived): **General** (`default` — the migrated pre-multiconv history) and **Athena / Notices** (`athena-notices`, pinned) — the single home for ownerless proactive nudges (daily brief, incident/blocker nudges), so proactive messages never scatter across threads.

**Backend.** `companion_session` is generalized into the conversation registry (title / status / pinned / origin / last-read); `companion_node.session_id` scopes episodes per thread. Commands: `companion_list_conversations`, `companion_create_conversation`, `companion_rename_conversation`, `companion_archive_conversation`, `companion_mark_conversation_read`; `companion_send_message` / `companion_list_recent_messages` / `companion_reset_conversation` all take an optional `conversationId` (omit → `default`). Turns **serialize within a conversation** (a per-thread lock protects that thread's `--resume` + brain writes) but **run concurrently across conversations** — unbounded, because every Athena spawn uses Claude subscription auth, not metered API. Every turn's system prompt also carries a **roster digest** of the user's other open threads, so one Athena stays aware of all of them.

**Per-thread state discipline (multiconv P1).** Everything turn-scoped is partitioned by conversation so concurrent threads can't corrupt each other: the frontend keeps a **per-conversation live-turn slice** (`companionStore.liveTurns` — streaming flag/text/phase/beat + turn id, with the legacy flat fields kept as a read-mirror of the *active* thread) and routes every `companion://stream` event by the `sessionId` it carries, so a background thread's stream can never mutate the focused thread's bubble; the **mid-turn queue is per-thread** (drained on that thread's own completion edge) and Stop interrupts the focused thread's turn specifically. Backend companions: autonomous-continuation generations are **keyed by conversation** (a user message in thread A no longer cancels thread B's chain — the explicit Cancel-autonomy control remains a global brake), background jobs carry their spawning `conversation_id` (the orb/tray still aggregate ALL threads' tasks), the reset `⟳` wipes **only that thread's** episode rows, and every chat-turn CLI child is `kill_on_drop` so a cancelled turn can't orphan a `claude` process.

**Turn model routing (P4).** `companion/model_routing.rs` is the single source of truth for which model + reasoning effort each Athena call class runs on, calibrated by the 1,026-turn bench (`docs/plans/athena-model-bench-report.md`): main conversational turns run **Opus @ low effort** (bench: identical accuracy to the default at 16% lower latency), headless micro calls (`athena_reaction::cli_text*` — titles, triage legs, one-shot classifications) run **Sonnet 5 @ low**, and the future aside lane is pinned at **Sonnet 5 @ medium**. `PERSONAS_ATHENA_MODEL` / `PERSONAS_ATHENA_EFFORT` env vars override main turns per-spawn for bench runs; `PERSONAS_DUMP_PROMPT=1` snapshots composed prompts for replay.

**Live unread + orb attention badge.** A background thread that finishes a turn bumps its unread badge in the switcher — and the footer orb — without being opened. `useConversationRoster` (mounted on the always-present orb, so it runs even when the panel is closed) hydrates the registry and refetches it on every `companion://turn-summary` event, which `send_turn` emits for **all** turns including proactive ones. The orb shows a **thread-attention badge**: the count of *other* threads awaiting you (the thread you're viewing is kept read by definition). Forwarding from a dashboard (**"Ask Athena"**, `useForwardToAthena`) opens its **own** fresh thread — titled from the message's first line — so a forwarded ask never lands mid-conversation in whatever thread happened to be active.

**Telling threads apart (orb identity).** With many threads live, the single orb has to say *which* conversation it's handling, or replies blur together. Two rules keep it unambiguous:

- **Audio is single-owner and focused-only.** Only the thread you're actively in ever speaks: the reply auto-play fires solely in the active-thread send path, and background/proactive turns spawn *voice-off* (`send_turn(…, voice=false, …)`). So you never hear two threads at once, and whatever you *do* hear is the thread you last sent to — background replies stay silent and surface as a badge, never speech.
- **Visual is orb state; the name is in chat.** When a **background** thread finishes, `useConversationRoster` pulses the orb's message reaction — a state change, not a text surface. *Which* thread replied is carried by the footer/orb thread-attention badge (count of other threads awaiting you) and, at full fidelity, by the conversation switcher inside chat. This replaced a named footer-notice popover: naming a thread is full information, and full information belongs in the chat window (see "Two dimensions").

## Approvals and navigation

Athena actions can create pending approvals. The panel lists them through `companion_list_pending_approvals` and resolves them through `companion_approve_action` or `companion_reject_action`.

**Not every approval comes from a chat turn.** `backlog_apply_triage` is created by the app, not by Athena's grammar: pressing **Send to Athena** on Approvals › Backlog runs one headless micro-tier turn (`companion/proactive/backlog_triage.rs`) over up to 30 selected `dev_ideas` and persists its per-item accept/reject verdicts as a pending approval whose params are the verdict list. Approving that card applies every verdict through the shared `apply_idea_verdict_by(..., "Athena")` core (`execute_backlog_apply_triage`); the Backlog's own verdict card takes a second door — `dev_tools_apply_triage_verdicts` — which layers per-item human overrides on first. It is **deliberately absent from `AUTOAPPROVE_ALLOWLIST`**: the reject arm writes a durable `constraint` memory per item, so an unreviewed batch could quietly teach the whole loop never to re-propose a month of work. Ideas (main DB) are written before the approval row (user DB) is closed, and verdict application is idempotent, so a crash between the two pools replays safely.

Events:

- `companion://approvals`: newly created approval rows.
- `companion://navigate`: direct route switch requested by Athena. The route `monitor` is a pseudo-route — it opens the full-screen [Persona Monitor](../monitor.md) overlay instead of switching a sidebar section. Athena fires it (after a short spoken/written summary) when the user asks for a fleet overview.
- `companion://stream`: streaming turn output from the backend. With `--include-partial-messages` (see "Stream deltas" below) it carries `stream_event` lines with `text_delta` chunks. The panel **consumes** these — to fire Athena's `PROGRESS:` beats live and flip the status line to "Composing reply…" — but does **not** render token-by-token prose (that was removed; the full reply lands in one piece when the turn finishes).
- `companion://recall-preview`: per-turn rollup of what the brain pulled into the system prompt (counts + titles per memory kind).
- `companion://turn-summary`: per-turn rollup of dispatcher side-effects keyed by assistant episode id (approvals / navigations / lab opens / dashboards / cockpits / chat cards / continuation flag).
- `companion://job`: background-job status transitions (queued → running → terminal). In-flight emits may carry a transient `progressText` so a running job reports what it's doing.

Approval outcomes may include a client-side action such as `{ type: "navigate", route }`. One such action, `{ type: "open_external_url", url }`, backs the **open test environment** capability: when you ask Athena to open/launch a dev project's test environment (test env / staging), she proposes an `open_test_env` action; on approval the backend resolves the project and returns its configured test-environment URL, which the frontend opens in the browser via the validated `open_external_url` command. The project must have a test-environment URL set in Dev Tools first, or the action errors with a hint to set it.

## Recall preview strip

Each turn, after the prompt builder runs but before the CLI spawns, the backend emits `companion://recall-preview` carrying a `CompanionRecallPreview`: `episodeCount` plus titled entries for doctrine, facts, procedurals, goals, and backlog (capped at 60 chars per title, server-truncated with an ellipsis). A `synthesized` flag indicates the recall was over budget and was folded through `recall_synthesis` into a focused briefing.

The panel renders this as a thin `RecallStrip` collapsed above each assistant bubble: a single-line summary ("Athena replayed 5 recent turns and consulted 12 memories") that expands on click to show the actual titles grouped by kind. The strip persists on the bubble for the rest of the session; an app restart drops the strip (recall is ephemeral working memory).

Stage 2 wired: each chip is a button that calls `setBrainView({ open: true, kind, id })` to open the Brain Viewer as an overlay over the chat transcript, jumped straight to the detail view for that memory. Group→kind mapping matches the backend's parent kinds (`doctrine`, `fact`, `procedural`, `goal`, `backlog`) — `companion_get_brain_item` dispatches `fact` / `procedural` / `goal` / `backlog` to the scoped fetchers so the parent-kind lookup resolves whichever scoped variant owns the id. Closes the loop from "what did Athena consult this turn" to "what's actually in that memory."

**Detail-view linked memories.** Inside the BrainViewer's DetailView, the rendered markdown is also scanned for memory-id tokens (`goal_xyz`, `procedural_abc`, `design_decision_def`, etc. — see `parseBrainLinks.ts` for the full kind list). Each unique reference becomes a small chip in a "Linked memories" strip below the content (via the shared `BrainLinksStrip` component); click → opens that memory's DetailView in place. Lets the user traverse the brain as a graph instead of a flat list. Orchestration tokens (`op_xxxx`, `sess_yyyy`) are intentionally excluded — they don't have a BrainViewer destination.

**Chat-bubble linked memories.** The same scan runs against the body of every completed assistant bubble — when Athena's reply mentions one or more brain ids, a tighter `inline`-variant chip strip renders directly below the bubble with the same click → setBrainView wiring. Skipped during streaming (partial text would make the chip set flicker as tokens come and go mid-reply). The chat is where Athena names memories most often, so this closes the graph-traversal loop where it pays off most.

## Turn-summary chip

Below each assistant bubble, a tiny caption-sized chip (`TurnSummaryChip`) surfaces what Athena's reply *did* — distinct from what she *said*. The chip aggregates dispatcher outputs from the same turn (pending approvals, direct navigations, lab tab opens, dashboard / cockpit auto-fires, inline chat-cards) plus a flag for `continue_autonomously`. Total-zero turns render nothing.

Source: the backend emits one `companion://turn-summary` event per turn after the dispatcher block, already keyed by the persisted `assistant_episode_id` so the panel can attach the chip to the right bubble without correlating turn ids. Same persistence model as the recall preview — promoted onto the episode id in the store, then written to the turn-sidecar row (see **Turn sidecars** below) so it replays after a restart.

### Transcript pagination — scroll to the top to load earlier turns

The transcript read hard-capped at the newest 500 episodes with no way to reach past them, so a heavy day silently lost its morning from both the scrollback and the conversation-log export.

`companion_list_messages_before(conversationId, beforeCreatedAt, beforeId, limit)` serves **keyset** pages — not offset, because the transcript grows at the newest end while the user pages backwards. `episodic::list_before` mirrors `list_recent`'s ordering exactly, which is now a **total** order on `(created_at, id)`: without the `id` tiebreak, two episodes written in the same second could sort either way and a page boundary could both skip and repeat rows.

Fleet-event system rows are filtered from display *after* the limit is applied, so the response carries its own `nextBeforeCreatedAt` / `nextBeforeId` cursor computed from the RAW scanned rows, plus `exhausted` (fewer raw rows than the limit). Paging off the last visible message instead would make a page whose rows were all filtered look like the end of the transcript.

`useTranscriptPages.ts` drives it: the initial load is unchanged (newest 50), reaching within 120px of the top loads the next page, prepended with the scroll position preserved (the container grew above the viewport, so `scrollTop` shifts down by exactly that much). The cursor is **derived from the oldest loaded message** rather than kept as its own state — that's what keeps paging correct across the transcript refetches the panel already does after a finished turn, which replace the list with the newest 50. `prependMessages` dedupes by id. Exhaustion latches against the oldest message id, so it re-arms automatically when the anchor moves.

No list virtualization; the markdown-on-disk fallback reads in `episodic.rs` are unchanged.

### Turn sidecars — the four per-turn layers, persisted

The narration/tool trail, the TodoWrite plan, the turn-summary rollup, and the recall preview are all parsed **frontend-side** out of the Claude CLI stream and promoted onto the assistant episode id at the `finished` event. They used to live only in the Zustand store, so an app restart stripped every older bubble back to bare text and the dev conversation-log export lost the side channels for pre-restart turns.

One row per assistant episode now lands in `companion_turn_sidecar` (`episode_id` PK + four opaque JSON columns). The backend never parses the blobs — their shapes are owned by the frontend types (`StoredNarration` / `TodoStep[]` / `StoredTurnSummary` / `CompanionRecallPreview`).

- **Write** — `persistTurnSidecar(episodeId)` (`useTurnSidecars.ts`) fires right after the store's attach actions, reading the channels back out of the store. Fire-and-forget: a failure is a `silentCatch` breadcrumb and never blocks a turn. Trails are capped at 100 entries before the write. `companion_save_turn_sidecar` upserts with `COALESCE`, so the second write moment (the later `companion://turn-summary` event) layers the summary on without clobbering the trail/plan/recall.
- **Read** — `useTurnSidecarHydration(messages)` batch-fetches (`companion_get_turn_sidecars`) for every assistant message it hasn't looked up yet and merges the result into the four store maps. **Live entries always win** over hydrated ones. The render paths (`NarrationThread`, `OperationalThread`, `TurnSummaryChip`, `RecallStrip`) are untouched — they already key by episode id, so a hydrated map renders exactly like a live one.

Serialization is pure and tested in `turnSidecars.ts`. There is no streaming replay and no backfill of turns that completed before this shipped.

The clickable parts — `approval`, `card`, `composed dashboard`, `composed cockpit` — are buttons that jump to the corresponding surface: `approval`/`card` smooth-scroll the panel to the approvals or chat-cards container; both `dashboard` and `cockpit` navigate to home → cockpit. (The dedicated companion **Dashboard tab was retired** — Cockpit is the dynamic dashboard surface now, so a `compose_dashboard` auto-fire and its turn-summary chip both route to Cockpit.) Parts without a meaningful destination — `navigated` (already happened), `lab` (no agent id carried in the event), `continuation` (informational) — stay as captions.

## Connector-call live status cards

Athena's `use_connector` op auto-fires (no approval, by design — see `src-tauri/src/commands/companion/approvals.rs:207-210`) and enqueues a background `connector_use` job. The job worker dispatches through `src-tauri/src/companion/jobs/connector_use.rs::dispatch_capability` (Sentry / GitHub / Slack / Gmail today, with a fallback echo for unwired capability slugs).

**`operations_database` connector (B1, direction 1).** A built-in, always-active, **read-only** connector over the *operational* store (`personas.db` / sys DB) — distinct from `personas_database`, which reads the companion brain DB. It exposes one auto-fire capability, `query_operations`, dispatching to curated, parameterized, row-capped named views in `src-tauri/src/companion/jobs/operations_views.rs` (`executions_recent`, `cost_by_persona_day`, `messages_inbox`, `reviews_pending`, `incidents`, `goals_active`, `kpis_latest`). It lets Athena answer ad-hoc operational questions directly instead of deflecting (the bespoke `gather_fleet_digest` / `gather_daily_brief_digest` paths behind the Radar/Sunrise buttons stay as the deterministic flows). No mutation capability; `dispatch_capability` now receives the sys-DB handle (`cred_pool`) so operations views read the right store. Doctrine: `docs/concepts/operational-data-views.md` (constitution **v34** teaches the views + the untrusted-content guard). The free-form `execute_select_operations` escape hatch is a documented follow-up.

Previously the user only saw the result as a system episode after Athena ingested it on her next turn. Now the panel subscribes to the `companion://job` event channel and renders an inline `ConnectorCallCard` per in-flight or terminal `connector_use` job, pinned under the assistant bubble that produced it:

- **queued** — hourglass + neutral border
- **running** — spinning loader + blue border; shows the job's live `progressText` ("Calling Sentry…") when present, falling back to the static in-flight hint
- **completed** — check + green border, result-markdown collapsed until click
- **failed** — alert + rose border, error text collapsed until click; surfaces a `Retry` button (Cycle 5) that re-enqueues the same paramsJson via `companion_enqueue_job`. The retried job's live status (queued → running → completed / failed) renders inline below the original failed card, subscribed via the global `jobsById` map so the user doesn't have to scroll the panel hunting for the new card (Cycle 10).

The running handler reports intermediate progress through a `JobProgress` reporter (`src-tauri/src/companion/jobs/mod.rs`) that re-emits the job row with a transient `progressText` on the same `companion://job` channel — event-only, never persisted, so the terminal emit clears it. `connector_use` reports "Calling {service}…" before the HTTP call; `scan_codebase` reports "Scanned N files…" every 2,000 walked entries.

Cards correlate to turns via the same pending → episode-id promotion the recall strip uses (jobs queued during streaming live in `pendingConnectorJobIds`; at the `finished` stream event they move into `connectorJobIdsByEpisodeId[assistantEpisodeId]`). No new IPC — the existing `companion://job` event channel carries everything the card needs.

## Activity tray & generic task tags (async-UX phase 2)

The connector-call card is the rich, per-call detail surface. Alongside it, a persistent **activity tray** (`ActivityTray.tsx`) docks just above the composer and lists **every** in-flight task across the whole session — not turn-bound — so parallel work from different turns is glanceable in one place. It reads the same `jobsById` map, filters to `queued`/`running`, sorts running-first, is collapsible, and renders nothing when idle.

Each tray row (and any in-chat tag for a non-`connector_use` kind) is a compact `TaskTag.tsx`: status icon (queued hourglass / running spinner / done check / failed alert), the task's `short_title`, a determinate progress bar when the handler reported `progress_current`/`progress_total` (e.g. a codebase scan's "8/17"), otherwise the live `progress_text` note, and a status label. `connector_use` keeps its richer `ConnectorCallCard`; every other kind (`scan_codebase`, `memory_curation_run`, …) uses the lightweight tag.

In-chat pinning generalizes the connector mechanism: `connector_use` always pins under its spawning bubble (it only auto-fires mid-turn); any other kind enqueued **while a turn is streaming** also pins there. Tasks spawned from an approval click while Athena is idle don't squat on the transcript — they appear only in the tray. Strings: `plugins.companion.task_status_{queued,running,done,failed}` + `tasks_running_{one,other}`.

## Non-blocking conversation (async-UX phase 4)

The composer is **never disabled while a turn is streaming** — the user can always type. A mid-turn send is classified by `classifyMidTurnIntent` (`midTurnIntent.ts`):

- **Redirect** ("stop", "wait", "actually…", "instead…", "cancel", "no, …") → **interrupts** the in-flight turn (the existing `companion_interrupt_turn` path kills the CLI child and finalizes the partial reply as `[interrupted]`) and queues the new message.
- **Additive / ambiguous** ("and also…", "when you're done…", or anything that isn't a clear redirect) → **queues** behind the current turn. The default is queue: an ambiguous message never destroys running work (the user can hit Stop explicitly).

Queued messages live in `companionStore` (`queuedMessages` + `enqueue/shift/remove/clear`) and render as cancellable chips above the composer (`QueuedMessages.tsx`). A streaming-edge effect drains them **one per turn completion** (FIFO), so order is preserved and the drain never collides with the autonomous-continuation chain.

On the model side, an always-on **"delegate, don't inline"** prompt addendum (`prompt.rs` `delegation_addendum`) tells Athena to kick long work off as a background task and reply immediately ("I'm pulling that — back in a moment") rather than holding a silent turn open for minutes. The activity tray + orb dots are what make that delegation observable, so the three phases compose: Athena delegates → the task shows in the tray/orb → the user keeps talking while it runs.

**Long in-turn tool calls (no longer promoted to tasks).** Work that happens *inside* Athena's CLI turn — a `WebFetch`, a `Bash` command, a `Task` subagent, a globally-configured MCP tool — used to be timed by the panel and, past `IN_TURN_TOOL_THRESHOLD_MS` (6s), promoted to a synthetic task in `companionStore.inTurnToolJobs` so it surfaced in the activity tray and as an orb dot. That promotion was **removed** with the rest of the per-tool reporting: between the tray row, the phase label and the narration log, one slow tool call announced itself three times, and none of it told the user anything they could act on. The typing dots already say she is working. `extractToolEvents` still runs (it feeds the narration timeline, which backs the turn sidecar and the dev log), and the `inTurnToolJobs` store slice + its ActivityTray merge are intact — nothing writes to them from the chat, so the tray now shows only real backgrounded jobs (connector calls, scans). `TodoWrite` was, and remains, excluded: it has its own checklist UI.

## Stream deltas & the operational thread

Two surfaces keep a long or autonomous turn from going silent between the user's message and the final reply.

**Stream deltas (consumed, not rendered).** Athena's CLI spawn (`src-tauri/src/companion/session.rs`) passes `--include-partial-messages`, so the CLI emits `stream_event` lines with `content_block_delta` / `text_delta` chunks ahead of the whole `assistant` message. The panel extracts those deltas (`extractAssistantTextDelta`) and accumulates them into the in-flight `streamingText` buffer, coalesced once per animation frame (`chat/athenaChatDeltas.ts`) — but **deliberately does not render them as visible prose** (see the comment in `chat/AthenaChatStreamingTurn.tsx`). The raw token stream reflowed constantly and leaked Athena's machine grammar (`OP:`/`QR:`/`TTS:` directives) before the server-side strip, so it was removed (design rationale: [`conversation-orchestration.md`](./conversation-orchestration.md)). The accumulated stream is used for two things instead: (1) firing Athena's `PROGRESS:` beats the instant each one appears (the beat text is split out of `streamingText`), and (2) deduping the trailing whole-message `assistant` text via `sawDeltasRef` so it isn't double-counted. The streaming bubble stays a single status line + `OperationalThread` until `finished`, when the full prose reply replaces it in one piece. Because `streamingText` changes on every animation frame, **nothing subscribes to it with a selector** — the beat scanner (`chat/athenaChatVoice.ts`) reads it through an imperative `useCompanionStore.subscribe`, so the transcript is never re-rendered by the token stream. The change is additive: on a CLI that doesn't emit partial messages the panel falls back to the whole-message path unchanged, and the backend's whole-message accumulation (which drives the persisted episode) is untouched.

**Operational thread (live plan).** When Athena calls TodoWrite during a turn, the panel parses the full checklist (`operationalSteps.extractTodoWrite`, latest call wins) and renders it inline under the bubble as an `OperationalThread` — each step shown as pending / in-progress / completed, updating in place. It uses the same `streamingSteps → stepsByEpisodeId` promote-on-`finished` model as the recall strip and connector cards, so the plan pins under the in-flight bubble while running and under the completed bubble afterward. Persisted in the turn-sidecar row, so it replays after a restart.

## Athena-scheduled proactive check-ins (`schedule_proactive`)

Trigger-driven nudges (goal target approaching, backlog aging, cadence due, on-this-day) come from `proactive::triggers::collect_all` and fire whenever the evaluator finds something worth surfacing. The `schedule_proactive` op gives Athena a second path: she commits to a future ping with a specific message at a specific time.

Wire:

- Op: `propose_action: schedule_proactive { message, when_iso }` — created in `src-tauri/src/companion/dispatcher.rs` (`ALLOWED_ACTIONS` entry; same approval-card flow as `write_fact` / `write_goal`).
- Approval executor: `execute_schedule_proactive` in `src-tauri/src/commands/companion/approvals.rs` parses + validates the RFC3339 timestamp (rejects past times), then calls `proactive::insert_scheduled` to persist a row with `trigger_kind='athena_scheduled'` and `scheduled_for=when_iso`.
- Schema: `companion_proactive_message.scheduled_for` (TEXT, nullable). NULL = trigger-driven (delivered as soon as quiet/budget/dedupe pass). Non-NULL = scheduled (held in `queued` until the time arrives). Migration is a defensive `ALTER TABLE` in `db::init_user_db`.
- Delivery: `proactive::release_pending` — the **single** release sweep, run on every 5-minute scheduler tick (and by `companion_evaluate_proactive_now`). It takes every deliverable `queued` row, scheduled (`scheduled_for <= now()`) and trigger-driven alike, so both kinds surface on the same `companion://proactive` channel. It replaced `deliver_due_scheduled`, which only ever ran from the manual command — a command with no callers in `src/` — so in practice the scheduled lane never fired at all. Undelivered rows are never stranded: they wait for the next tick, or are aged to `expired` (1 day for trigger-driven rows, which then re-fire fresh; 7 days past due for scheduled commitments, which have no re-fire path).
- UI: the existing `ProactiveCard` renders the message — a sky-blue accent + "scheduled by Athena" label disambiguates the kind. Engage / Dismiss work identically.

Why approval-gated when `use_connector` isn't: a scheduled check-in puts a future obligation on the user's attention. Unlike connector calls (which run on pre-greenlit pinned credentials), the consent isn't already present — Athena's "I'll ping you about X in 3 days" needs the user to actually agree before the row lands.

## What Athena can see — the grounding index (constitution v45)

Before any of the per-surface wiring below matters, she has to know what exists. For a long time she did not: she was shown the **names** of ten recently-active personas and nothing else, while ops like `run_persona`, `run_arena` and `assign_team` all take a UUID. She was proposing ids she had no listing of, and the context map and skill library were invisible to her entirely (the context map appeared only as prose telling her a background job produces one).

Three blocks now ride in every system prompt, each a **name + real id + one line**:

- **Personas** — name, `id`, a one-line capability summary, model tier. Ordered `enabled DESC, updated_at DESC`.
- **Dev contexts and groups** — name, `id`, one line. Ordered `pinned DESC, updated_at DESC`.
- **Skills** — name, scope, and the one-line `when to use` parsed from the skill's own frontmatter (same parser the Skills UI uses). Ordered alphabetically, because an index is a lookup table and not a feed.

**The budget is real, not aspirational.** `INDEX_TOKEN_BUDGET = 1200` tokens × `CHARS_PER_TOKEN = 4` = 4800 chars, split 2000 / 1600 / 1200 across the three blocks, with a compile-time `const _: () = assert!(…)` keeping the split inside the total. `BoundedBlock::push_row` refuses a row that would eat the block's footer reserve, so the honesty line can never be squeezed out by content. Measured against 200 personas + 200 contexts + 200 skills: 4491 chars (~1123 tokens), showing 10 / 15 / 15 rows.

**Every block ends by admitting what it hid.** The footer states `Listing N of M` and names the read op that recovers the rest, in the persona block's own words: *absent here does NOT mean absent from the app*. That sentence is the point of the whole design. A truncated list that pretends to be complete is worse than no list, because it invites her to conclude a persona does not exist.

**Detail on demand — four read ops**, all auto-fire, all bounded (`READ_OP_DETAIL_CHARS = 1600`), all returning their answer as a System episode she reads on the next turn:

| op | returns | on a miss |
|---|---|---|
| `describe_persona` | one persona in full | names up to 5 real candidates |
| `describe_context` | one dev context in full | same |
| `describe_skill` | one skill's full when-to-use | same |
| `list_teams` | the team roster with ids (`LIST_TEAMS_MAX_ROWS = 25`) | — |
| `list_runner_tasks` | the Dev Runner's live queue — queued + running only, ≤20, optional name/project filter | says the queue is empty rather than returning a blank body |

Teams were deliberately left **out** of the always-on index and given a lookup instead: `assign_team` needs a `team_id`, but a roster is not worth permanent prompt rent.

**The Dev Runner is the second execution lane, and it now has a door.** Athena could dispatch Fleet sessions all day while a task for the same work sat queued on the Run Desk, because she could not see it. `list_runner_tasks` is the read half; **`enqueue_runner_task { title, description?, depth?, project… }`** is the write half, and it mirrors the fleet ops' grammar exactly: approval-gated (deliberately absent from `AUTOAPPROVE_ALLOWLIST`), containment through the same `resolve_dev_project` registry lookup every other dev op uses, bounded input, `depth` validated against `quick | campaign | deep_build`. It **only enqueues** — starting a task stays the operator's click on the Run Desk, because execution spends real money and the queue is the reviewable surface between a proposal and that spend.

**`open_route` gained `mastermind`.** Like `monitor` it is a pseudo-route (it resolves to Teams → Mastermind rather than a sidebar section). It earns one because Athena can already read, annotate, compose on and steer that canvas but had no way to simply take you there — and because *arriving* is what makes the canvas publish its scene to the settings key that every one of those ops reads, so navigation doubles as the refresh for a stale or absent snapshot.

Two properties worth keeping when this is extended:

- **The read ops are dispatcher arms with no executor**, and are deliberately absent from `ALLOWED_ACTIONS`. An entry there requires a matching executor arm, and those two lists have silently diverged before — an op that is only ever *read* has nothing to diverge from. A guard test asserts every read op has an arm, and an invariant test asserts `READ_OPS ∩ ALLOWED_ACTIONS = ∅`.
- **`describe_skill` reads the filesystem**, so it is the one member of the family that still answers when the system DB is unreachable; the others fail closed and say so rather than guessing an id.

The old names-only "Recently active" line was **removed** from the observability digest when this landed, so there is exactly one persona listing in the prompt rather than two that disagree about which agents matter.

> **Deployment note.** The constitution is read from `~/.personas/companion-brain/constitution.md`, not from the repo at runtime. An upgraded install keeps its existing file, so Athena will not know a newly added op exists until that file is refreshed. A feature can look broken on an upgrade for this reason alone.

## Project goals (dev direction) — read + propose + react

Athena is wired into the project [Goals](../goals/README.md) surface at the **read + propose, writes-gated** authority level:

- **Read** — `prompt.rs::format_project_goals(sys_db)` injects each dev project's active goals (id, progress, status, latest signal) into her system prompt (appended to the plugins block, in both the ml and non-ml builders), so she's aware of project direction and can reference a goal by id.
- **Propose (gated)** — the `update_dev_goal { goal_id, status?, progress?, note? }` op (`ALLOWED_ACTIONS` + `execute_update_dev_goal` in `approvals.rs`, constitution **v27**) lets her propose a status/progress change. It is **approval-gated and deliberately NOT in `AUTOAPPROVE_ALLOWLIST`** — goal writes never auto-resolve, even in autonomous mode. On approval it writes an `athena_update` `dev_goal_signal`.
- **React (proactive)** — `proactive::triggers::dev_goal_nudges(sys_db)` emits budget+dedupe-gated nudges (`dev_goal_target`, `dev_goal_stalled`) when a project goal is target-approaching/overdue or stalled (in-progress/blocked, untouched ≥ 7 days). Because `dev_goals` live in the main app DB, it's passed as `extra` candidates to `evaluate_with_extra_candidates` from the manual `companion_evaluate_proactive_now` (`state.db`) and the desktop tick (`app.state()`). On engage, the prompt context lets her reason and propose the gated update.

## Project KPIs (outcome steering) — read + manage

KPIs are the [outcome layer above goals](../kpis.md): a KPI going off-track is what *derives* a goal. Athena manages that steering layer on the user's behalf, at the same **read + propose, writes-gated** authority as goals (constitution **v40**):

- **Read** — `prompt.rs::format_project_kpis(sys_db)` injects each dev project's **active** KPIs (id, current/target + unit, tier, and an `on track` / `OFF TRACK` / `unmeasured` state) into her system prompt, appended to the plugins block in both builders. The off-track state is computed by the SAME rule the derivation loop obeys (`kpi_derivation::kpi_is_off_track`), so what she sees as `OFF TRACK` is exactly what will derive a goal — there's no second opinion to drift.
- **Manage (gated)** — three ops in `ALLOWED_ACTIONS` + `approvals.rs`, all **approval-gated and NOT in `AUTOAPPROVE_ALLOWLIST`** (they change what the autonomous loop optimizes for, so the user signs off):
  - **`calibrate_kpi { kpi_id, target_value?, target_date?, tier?, cadence?, status?, warn_at?, crit_at? }`** (`execute_calibrate_kpi`) — adjust the steering levers. Targets / tier / cadence / status route through `update_kpi`; the `warn_at` / `crit_at` lines route through `save_kpi_assessment` (the same path the Factory console writes). `crit_at` is the **hard "off track" line the derivation loop now honors** — moving it directly changes when this KPI derives a goal. Enum fields are validated so a hallucinated token can't poison steering.
  - **`evaluate_kpi { kpi_id }`** (`execute_evaluate_kpi`) — measure the KPI now (codebase / derived / connector), saving a fresh point to its history. Lets her un-stale a KPI before reasoning about whether to steer.
  - **`scan_kpis { project_name?, path? }`** (`execute_scan_kpis`) — launch a KPI proposal scan for a project (resolves id/name/path with a most-recent fallback, like `enqueue_dev_job`). Proposals land in the review queue; nothing goes active without the user's accept.
  - **`propose_kpi { project_name, name, category, direction, measure_kind, cadence, unit?, tier?, needed_connector?, derived_metric? }`** (`execute_propose_kpi`, constitution **v41**) — configure ONE specific KPI from a guided conversation. When the user asks to set up / add a KPI, the digest tells Athena to GATHER its shape (what to measure, higher/lower-is-better, target, cadence, manual vs automatic) and then emit this op. It creates a **proposed** KPI via `kpi_compose::propose_kpi_auto_inner` (shared with `dev_tools_propose_kpi_auto`) and, for the codebase mechanism, a **background measurement setup**; the user verifies it in the Teams › KPIs queue. The Factory's Add-KPI modal has an **"Ask Athena"** button that hands off to this flow (drops a starter prompt into the chat via `companionStore.pendingChatPrompt`).

## Mastermind canvas (read + act) — constitution v46

Athena is wired into the [Mastermind canvas](../teams/README.md) at the same **read + propose, writes-gated** authority as goals and KPIs.

**Why a published snapshot, not a Rust re-derive.** The scene is derived entirely on the frontend: an App Readiness Passport per project folded through fifteen dimension `derive()` closures (`sub_mastermind/lib/dimRegistry.ts`), plus five independently-fetched data families whose per-family load **status** is itself part of the picture (a cell reads `unknown` when its family failed, which is not the same fact as `absent`). None of that exists in SQLite. So the canvas publishes a compact snapshot to the `mastermind.scene.v1` app setting after each derive, and `src-tauri/src/companion/canvas.rs` reads it. The JSON contract is documented on `canvas::CanvasScene`. Until the canvas has been opened once the key is absent, and every surface says so plainly rather than inventing a scene.

- **Read (always-on digest)** — `prompt.rs::format_scene_digest(sys_db)` injects a **worst-first** block: one row per project with its state, `NEEDS YOU` marker, blockers, live fleet session count, and only the dimension cells that are NOT fine. Ordering is `attention → island state → alerting cells → blockers → total unhealthy cells`, slug ascending as a stable tiebreak — it is a triage surface, not a directory. Its own ~1200-token budget (independent of the three index blocks, so neither starves the other), enforced through the same `BoundedBlock` footer-reserve mechanism, and the footer carries the true project count plus which data families are currently `failed`/`stale`. No snapshot published means **no block at all**.
- **Read on demand (auto-fire, no approval)** — `describe_canvas_project { query }` returns one island's full fifteen cells with their detail strings, monitoring, milestones and live counters; `describe_canvas_freshness { query? }` returns idea-scan age, ongoing goals and KPI standing for one project or (empty query) for all of them, worst-first. Both are `READ_OPS` dispatcher arms with no executor, bounded, and answer an unknown slug by naming real ones.
- **Act (gated)** — three ops in `ALLOWED_ACTIONS` + `approval_exec_canvas.rs`, on `AUTOAPPROVE_ALLOWLIST` so they follow the **boldness dial** exactly like `fleet_spawn` / `fleet_dispatch`:
  - **`canvas_dispatch { slug, task, skill? }`** — one CLI session in one project.
  - **`canvas_group_dispatch { slugs[], task, skill?, group? }`** — one instruction across several projects, **sequential by construction** (it routes to `execute_fleet_dispatch`, whose single `for` loop spawns one after another; the canvas is explicit that parallel spawning stalls the machine) and capped at the same **8**.
  - **`canvas_run_idea_scan { slug, scan_types?, target_count? }`** — routed to the same `run_scan_core` the Ideas cell calls, so the backlog-saturation guard and stale-idea archival apply unchanged.

  All three are **thin slug-resolving wrappers, not new privileged surface**: they turn canvas slugs into the same `FleetPlanRow` shape the chat plan card produces and hand off to the existing executors, so `validate_fleet_cwd_in_db` containment is unchanged. Both dispatch paths write **one** ledger row via `record_fleet_plan_decision` (outcomes `canvas_dispatched` / `canvas_dispatch_failed`), which funnels into the single `record_fleet_decision` choke point.
- **Demo islands are refused.** When no projects are registered the canvas draws six `demo-*` placeholders with no repo and no passport. Every read and action path refuses them by name with the reason, rather than failing three layers down on a missing path.

### Composing a panel beside the canvas — constitution v47

- **`compose_canvas_panel { slug, spec }`** (auto-fire, no approval card) docks a **SurfaceSpec v1** surface next to one project's island. The canvas is the artifact she acts in, so structured findings about a project belong beside it rather than scrolling past in chat; chat and the orb stay where she talks.
- The dispatcher validates two things the frontend cannot: the slug resolves against the **published scene** (`canvas::resolve_scene_slug` — demo islands and invented names are refused, with real slugs named in the refusal), and the spec is a `{"surface":"v1", blocks:[1..12]}` envelope. Without a reachable snapshot it fails closed.
- Nothing is persisted server-side. `session.rs` emits `companion://compose-canvas-panel` with `{ slug, specVersion, spec }`; the frontend bridge writes it into the canvas layout document (`mastermind.layout.v1` → `athenaPanels[slug]`), routes to Teams → Mastermind and drives the **camera** to that island (off-screen islands are culled from the DOM, so focus can never be a node lookup).
- Rendering goes through the shared `SurfaceRenderer`: a hallucinated block is dropped rather than rendered, and every action inside a panel is still consent-gated at click time. A panel proposes; it never runs anything.
- **Per-project reset.** The panel carries its own reset control (`mm-athena-panel-reset`), separate from the canvas-wide annotation revert — persisting a composed surface is only safe if one click removes it. An envelope version this build does not understand degrades to *no panel*, never a permanent error box.

### Steering the canvas — constitution v49 (`canvas_control`)

- **`canvas_control { action }`** (auto-fire, max 4 per turn) is the door onto the canvas **action grammar** (`sub_mastermind/lib/canvasActionStore.ts`): camera verbs (`camera.read` / `pan` / `zoom` by factor or band / `focus` / `fit`) plus the zoom-gated opens (`dim.open` travels close and opens the cell's own Improve popover; `category.open`; `island.menu`). View only — the camera moves or a popover opens, nothing mutates, which is the whole consent argument for auto-fire.
- The dispatcher validates what the frontend cannot: the kind is one the grammar speaks, any slug resolves against the **published scene** (demo islands refused by name), bands ∈ far/mid/near/close, numbers finite. Only validated fields are re-serialized, so an invented param never crosses the IPC boundary. The read kinds (`island.read`/`dim.read`) are refused with a pointer to `describe_canvas_project`, which answers synchronously without a frontend round-trip.
- `session.rs` emits `companion://canvas-control` with `{ sessionId, action }`; the app-wide bridge (`useCanvasControlBridge`, mounted beside the panel bridge) routes to Teams → Mastermind, dispatches into the grammar queue (whose 2s pickup window carries the action across the route-in mount), and reports the settled `CanvasActionResult` back through **`companion_canvas_control_result`** — a System episode in the originating session, so Athena reads on her next turn where the camera actually landed (band, visible islands, clamps) or why it refused (`band_too_far`, `unknown_target`, `canvas_closed`). The same grammar is drivable without Athena via the dev-gated `window.__mmCanvas` bridge (`canvasTestBridge.ts`) for live testing on :17320.

## Incidents (proactive blocker nudge)

Athena proactively surfaces OPEN high/critical [audit incidents](../overview/README.md) so the user is nudged about them even while away/unattended.

- **React (proactive)** — `proactive::incident_triggers::incident_blocker_nudges(sys_db)` emits a single budget+dedupe-gated nudge (`trigger_kind = incident_blocker`) when there are OPEN incidents at `severity in (high, critical)`. It reuses `audit_incidents::list` (filtered to `status=open`, severity high/critical), is priority-ordered (critical first), count-aware in the message, and anchors `trigger_ref` on the most-severe incident's id. Because `audit_incidents` live in the main app DB, it's passed as `extra` candidates to `evaluate_with_extra_candidates` from both the manual `companion_evaluate_proactive_now` (`state.db`) and the desktop tick (`app.state()`) — exactly like `dev_goal_nudges`.
- **Engage** — clicking Engage on the `ProactiveCard` (rose accent, "incident needs attention" label) navigates to the **Overview → Incidents** inbox (`setSidebarSection('overview')` + `setOverviewTab('incidents')`). Landing on the inbox is the goal; deep-linking to a specific incident detail is a deliberate follow-up.

## Autonomous signal economy — execution triage + message triage

At fleet scale (hundreds of executions an hour), the question stops being "can Athena review this?" and becomes "what may reach the user?". Both autonomous review legs route through ONE batched headless decision per pass (the `athena_reaction::cli_text` pattern — zero chat episodes) whose verdicts are tiered: **drop** (silent, tracing only) / **digest** (one line on one aggregated `ProactiveCard`, hour-bucketed dedupe) / **deep-dive or attention** (the only tier that spends chat or a desktop notification). Full gap analysis + architecture: [`autonomous-signal-economy.md`](./autonomous-signal-economy.md).

- **Execution triage** (`proactive/execution_review.rs`, autonomous-mode-gated) — flagged finished runs (failed/slow/expensive) since the cursor are grouped by (persona, reason) — 14 identical PAT failures become one group — and triaged in one decision. Digest lines land on an `execution_review` card; AT MOST ONE group per batch graduates to a full `TurnOrigin::Proactive` reasoning turn (with a ≤120-word format contract); `escalate_to_user` fires a desktop notification (quiet-hours guarded). This replaced the per-candidate design that spawned ≤2 full chat turns per tick and persisted "No response requested." episodes forever (episodes are append-only by design).
- **Message triage** (`proactive/message_triage.rs`, implied by autonomous mode — the master toggle ON means triage is active; the legacy `autonomous_message_triage` key is kept but no longer read) — the Overview → Messages counterpart of her human-review resolution: each unread message is classified **done** (routine — marked read with an `athena_triage` audit annotation in its metadata), **digest** (business value — summarized onto one `message_digest` card, then marked read) or **attention** (stays UNREAD for the user to read personally + notification). Code-level safety floor: high/urgent/critical priority can never be auto-resolved, whatever the model says. First enable seeds the cursor to "now" — the historical unread pile is never retroactively mass-read. Engaging the card lands on **Overview → Messages**.

The post-certification "are the teams on track?" review. When the user lets all teams run and risks losing the thread, Athena can review the fleet against the certification rubric and propose fixes.

- **Op (gated)** — `analyze_fleet { team_id?, days? }` (`ALLOWED_ACTIONS` in `dispatcher.rs` + `execute_analyze_fleet` in `approvals.rs`). Approval-gated because it spawns a CLI reasoning turn (cost), same rationale as `run_persona` / `assign_team`. Omit `team_id` to review the whole fleet; `days` defaults to 14.
- **What it does** — `spawn_fleet_analysis` first **pre-gathers** a compact per-team digest from the **operational store** (`state.db` = `personas.db`: exec counts, outcome distribution, failures, cost, avg `director_score`, **goal engagement** — `gather_fleet_digest`) — per team it reports whether a `team_assignment` is **ADVANCING** a goal vs the goal merely sitting on its pinned project (`has-goal/NOT-advancing`), each goal's **progress % + breakdown to-dos done/total** (`dev_goal_items`), **blocker count** (`dev_goal_dependencies`), the **last goal signal** (`team_*`/`athena_update` = the team/Athena working it), and the Director score **band** (excellent/healthy/at-risk/broken) and **embeds it in the directive**. This matters: Athena's `personas_database` connector points at the companion-brain DB (`personas_data.db`), not the execution store, so asking her to fetch the data fails — we supply it. The directive then names the rubric dimensions, and tells her to **recall her prior per-team note** for timeline continuity, **write an updated per-team note** via `write_fact`, and propose a few concrete improvements as gated ops. Spawned via `session::spawn_proactive_turn` (trigger kind `fleet_analysis`).
- **Trigger** — a **Radar** button in the companion toolbar's Assist group (`CompanionToolbar`, `data-testid="companion-analyze-fleet"`) calls the **`companion_analyze_fleet`** Tauri command **directly** (deterministic — it spawns the rubric-graded proactive turn itself). This is by design: routing the button through a chat message let Athena reasonably *shortcut* to an inline read from her observability digest and skip the dedicated turn + the per-team timeline-memory write, so the button bypasses the chat turn entirely. (Athena can *also* propose `analyze_fleet` in chat when asked — both paths share `spawn_fleet_analysis` in `approvals.rs`.)
- **Engine** — the deterministic read-only counterpart is `scripts/test/fleet-analyze.mjs` (per-team execution health, outcomes, Director verdicts, goal links, on-track flags); see [team-orchestration.md](../pipeline/team-orchestration.md). Athena reasons; the script measures.
- **"Ask Athena" from the dashboard (via the orb)** — the Mission Control **Fleet optimization** card (`overview/sub_missionControl/cards/FleetOptimizationCard.tsx`) carries a per-recommendation **Ask Athena** button. Unlike `analyze_fleet` (a gated rubric-graded turn), this is a lightweight forward through the **`useForwardToAthena`** hook (`plugins/companion/useForwardToAthena.ts`). It composes the recommendation (title / description / suggested action + a persona-or-general focus, from `t.overview.fleet_optimization.ask_athena_*`) and then: surfaces the floating **orb** (`state='minimized'`, not the full panel — falls back to `'open'` only if the orb feature is off), fires a one-shot amber "message received" ack glow on the orb (`companionStore.pulseForwardAck` → `forwardAckPulse` → `AthenaOrb`), sends the turn through the always-mounted `voiceTurnRequest` consumer (so it runs panel-closed), and — when voice is enabled + configured — speaks a short scripted, translated acknowledgement (`forward_ack_speech` = "Understood, processing the message.") for immediate feedback while the (often slow) turn spins up. The sibling **Open Lab** button skips Athena and navigates the user straight into the affected agent's Lab in matrix (model-comparison) mode. (Note: the older `pendingPrompt` forward — still used by `CockpitPanel` / `MessageDetailModal` / `GoalsPage` — opens the full panel instead; both consumers now claim their request atomically so StrictMode's dev double-invoke can't double-send.)

## Daily brief (`companion_daily_brief`)

The morning "what happened while I was away" summary. A **Sunrise** button in the
companion toolbar's Assist group (`CompanionToolbar`, `data-testid="companion-daily-brief"`)
calls the **`companion_daily_brief`** Tauri command **directly** — the same
deterministic, button-is-the-consent shape as the fleet-analysis Radar button, and
for the same reason: routing it through a chat message would let Athena shortcut to
an inline read, and her `personas_database` connector points at the companion-brain
DB (`personas_data.db`), not the execution store, so she can't fetch the inbox data
herself.

- **What it does** — `gather_daily_brief_digest` (`src-tauri/src/commands/companion/approvals.rs`)
  pre-gathers a compact digest from the **operational store** (`state.db` = `personas.db`)
  across the three operational inboxes over the last `hours` (default 24, clamped 1–168):
  **Messages** (`persona_messages` — count, unread, elevated-priority + recent titles),
  **Human Review** (`persona_manual_reviews` — new-in-window count plus the current
  all-ages `pending` backlog and its oldest titles, since an overdue review predates
  the window), and **Incidents** (`audit_incidents` — new-in-window plus current
  `open`/`acknowledged` backlog, severity-ordered, high/critical called out). The
  24h window uses `julianday()` math so it's correct across the tables' mixed
  `created_at` formats (RFC3339 for messages/reviews, datetime-text for incidents).
  `build_daily_brief_directive` embeds the digest and tells Athena to write a short,
  skimmable summary directly in chat — lead with the top thing to act on, one or two
  lines per inbox, flag overdue reviews + open high/critical incidents, and close with
  one concrete next action only if something needs it. Spawned via
  `session::spawn_proactive_turn` (trigger kind `daily_brief`), so the brief streams
  back into the panel like any proactive turn.
- **No approval, no new op** — unlike `analyze_fleet`, the daily brief is button-only:
  there is no `ALLOWED_ACTIONS` op and no constitution bump, because Athena never needs
  to *propose* it from chat. The click is the whole trigger.

## MCP request panel (D3 — batched approvals)

Pending MCP requests from fleet sessions land in `McpRequestPanel` above the chat transcript: one card per request, with guidance prompts taking text input and approvals taking ✓/✗ + an optional note. The panel groups by `fleetSessionId` so cards from the same session render together — and when a single session has 2+ pending `approval`-kind requests, the group header renders a primary "Approve all" button that fires `resolveMcpRequest(_, { approved: true, note: '' })` for every approval in that group in parallel (`Promise.allSettled` so one failure doesn't stall the rest). Guidance requests are never batched — they need typed answers.

Common case the batch unblocks: a fleet session pauses on 3-5 file-writes / shell commands / API calls in a row. Without batching, the user clicks Approve five times; with batching, one click clears the queue and the session resumes.

## Live ops strip (D7 — operative-memory view)

When orchestration is in flight, the strip above the chat transcript surfaces the same operative-memory digest Athena reads every turn. The frontend now parses the backend's markdown digest into structured rows (`parseDigest.ts`) and renders each in-flight operation as its own collapsible card: status badge, intent, duration, id, and a sessions count. Click an op → expand its sessions; each session shows its state, current tool, intent, latest checkpoint (with blockers if present), files touched, recent failure, and rolling summary — the same fields Athena sees, but navigable instead of one monospace blob.

Defensive: if the parser produces zero ops while the digest is non-empty (i.e. the Rust-side `OperativeMemory::digest_for_prompt` format drifts), the strip falls back to the original `<pre>` block so power users still see the raw view Athena consumes.

## Persona-design doctrine

When users ask "is my persona ready?" or "help me design a persona for X", Athena pulls from the doctrine corpus configured in `src-tauri/src/companion/brain/doctrine.rs`. In addition to the reference docs (`features/personas/01-data-model.md`, `02-capabilities.md`, `03-trust-and-governance.md`) and template docs, the corpus includes a prescriptive best-practices guide at `docs/concepts/persona-design-best-practices.md` covering: intent line shape, interactive vs one-shot build, system prompt structure, use case decomposition, capability scoping, tool definition discipline, trigger grain, credential hygiene, model tier selection, observability hooks, and a catalogue of anti-patterns to flag during review.

The guide is for the model's working context — it tells Athena *how* to evaluate or compose a persona, not just *what* the persona schema is. Edits go through the standard `companion_reingest_doctrine` flow (idempotent: only changed chunks re-embed).

## `show_persona_walkthrough` chat-card

The persona-design doctrine becomes actionable through a new auto-fire op: `show_persona_walkthrough { intent, content, title? }`. Athena emits it when a user asks "help me design a persona for X" — instead of replying in chat prose, she composes a long-form markdown plan and lands it as an inline card via the existing chat-cards event channel.

The card renders through a new `persona_walkthrough` widget in `cockpitWidgetRegistry`. Unlike the dashboard-style widgets (persona_overview, decisions_panel, etc.) it's not height-clamped to 260px — `InlineChatCard` recognizes `persona_walkthrough` as an unclamped kind so the markdown flows naturally and the chat scroll handles overflow. Header shows the intent + a sparkle accent; body is a `MarkdownRenderer` with prose-tight styles for nested lists, headings, and inline code.

Content shape is just `{ intent, content }` where `content` is the markdown blob Athena composed. The walkthrough typically includes: proposed intent line, system prompt outline, use case set, tools, triggers, model tier, observability hooks — the seven readiness items from the best-practices doctrine, applied to this user's specific intent. From there the user can act: pick a starter template, refine the intent, or commit to a build via `build_oneshot` / `prefill_persona_create`.

The walkthrough card carries a **"Build from this"** affordance — a primary button at the bottom that fires the same prefill (intent text, interactive mode) the approval-driven `prefill_persona_create` flow uses, then routes to the personas view. The user lands in `UnifiedBuildEntry` with the intent already filled in. No approval round-trip needed for this path — the walkthrough is itself a suggestion the user is reviewing, and the prefill commit just hands the conversation off to the standard build flow.

Constitution bumped to v9 so existing installs pick up the new op signature on next boot.

## `show_template_suggestions` chat-card

When a user describes a persona they want, Athena's first move shouldn't always be "let me design one from scratch" — often the gallery already has a near-match. The auto-fire op `show_template_suggestions { intent, limit? }` surfaces matching templates inline so the user can adopt instead of build.

Wire:

- Athena emits the op carrying the intent text only (no per-template knowledge required from her side).
- Dispatcher creates a chat-card `kind=template_suggestions` with `config={ intent, limit }`.
- The new `TemplateSuggestionsWidget` calls `companion_match_templates(intent, limit)` on mount (Tauri command in `src-tauri/src/commands/companion/templates.rs`). The command extracts keywords from the intent (3+ chars, stop-words filtered, cap 8) and runs them through the existing `search_reviews_compact` LIKE-match query — no LLM call, no async job.
- Results render as small cards with name, category, instruction snippet, connector chips. An "open gallery" affordance navigates to `design-reviews` so the user can follow through with the existing adoption flow (questionnaire + customization).

No direct adoption from chat by design — that would bypass the customization steps users expect from template adoption. Constitution bumped to v10.

## `show_use_case_set` chat-card

The walkthrough card (`show_persona_walkthrough`) sketches the whole design plan; this op zooms into the use-case-decomposition layer specifically. Athena emits `show_use_case_set { intent, use_cases }` carrying 3-5 use cases tagged by role:

- **golden** — the most common, most-valued input class. Airtight handling.
- **variant** — known input shapes needing different handling than the golden path.
- **out_of_scope** — inputs the persona should explicitly refuse.

The dispatcher validates the role enum and the array size (1-8, soft target 3-5). The widget sorts golden → variant → out_of_scope (most important to handle → must refuse cleanly) and renders each with a role-specific accent (emerald / violet / rose). Auto-fire, no approval — same suggestion shape as the walkthrough.

A persona with only golden cases breaks on its first edge-case input; the doctrine guidance flagged here pushes Athena to surface all three roles when she proposes a use-case set. Constitution bumped to v11.

## "Pin to cockpit" on inline chat-cards

Dashboard-shaped chat-cards (`persona_overview`, `connected_services`, `decisions_panel`, `metric_spark`, `issue_list`, `text_callout`) get a hover-revealed **Pin to cockpit** affordance in the top-right corner. Click → calls the new `companion_pin_widget_to_cockpit` Tauri command which loads the current cockpit spec, appends the widget with a fresh id and `span=4` default, and saves. Idempotent on the backend — pinning the same `{kind, config}` twice is a no-op.

Advisory cards (`persona_walkthrough`, `template_suggestions`, `use_case_set`) deliberately do NOT show the pin — they're read-once shapes, not persistent dashboard surfaces. Pinning them would dilute the cockpit's signal-to-noise.

Closes the loop between transient chat reasoning and the persistent cockpit surface: when Athena composes a useful widget inline (a status spark for a service, an issue rollup, a custom callout), the user can promote it to their dashboard with one click instead of asking Athena to compose a full cockpit from scratch.

## `show_trigger_set` chat-card (sibling of use_case_set)

Athena emits `show_trigger_set { intent, triggers }` to decompose a persona's input distribution from the trigger angle: 1-4 trigger configurations each with `label`, `source` (free-form: Slack webhook, scheduled cron, polling Sentry, manual), `condition` (what input shape fires this), and optional `grain` + `idempotency_note` to surface cycle-6 doctrine's right-grain test.

Together with `show_use_case_set` (the what-it-handles angle), the trigger card completes the persona-decomposition triangle. Widget renders each trigger with a source-aware icon hint (Bell for inbox/webhook, Clock for scheduled, Repeat for polling). Auto-fire — same suggestion shape as siblings; advisory not pinnable. Constitution bumped to v12.

## `show_model_tier_choice` chat-card

Picks up the model-tier-selection readiness item from cycle-6 doctrine. Athena emits `show_model_tier_choice { intent, recommended, tiers }` with the three Anthropic tiers (haiku / sonnet / opus), marking one as `recommended` and providing a 1-2 sentence rationale per tier. The widget sorts haiku → sonnet → opus and accents the recommended one (emerald border + star badge). Informational only — it doesn't write any selection; the user picks the tier when they reach the build flow.

Rationale shapes follow the doctrine heuristics: Haiku for high-volume routing/triage with structured output, Sonnet as the default for the majority of personas, Opus for long-context reasoning over large inputs or output where a single bad reply is expensive. Constitution bumped to v13.

## `show_observability_plan` chat-card

The 7th readiness item from cycle-6 doctrine: every persona needs an error path that doesn't black-hole AND at least one success metric tracked. Athena emits `show_observability_plan { intent, error_handling, success_metric }` to surface both.

`error_handling` is `{ triggers: [string], escalation: string }` — a list of named failure modes plus where they end up (typically the `manual_reviews` queue). `success_metric` is `{ kind, description, target? }` with `kind` in `count_by_status | cost_per_run | latency | custom`. The widget renders the two sections stacked: red-accented error path on top, emerald-accented success metric below, with a metric-kind-specific icon.

Auto-fire chat-card; informational only. Together with cycles 7-9 + 12-13, Athena now has structured chat-card surfaces for 5 of the 7 readiness items (intent overview, use cases, triggers, model tier, observability). The remaining gaps (system prompt structure, tools) were in-session sticky-dropped. Constitution bumped to v14.

## `show_decision_log` chat-card

Builds on top of the design-decomposition family rather than expanding it. After Athena has helped a user work through a design (across walkthroughs, use-case decompositions, trigger sets, tier choices), she can emit `show_decision_log { intent, decisions }` to surface the audit trail of choices made so far. Each decision has a `label` (what was decided), `choice` (what was picked), `rationale` (one sentence why), and optional `timestamp`.

The widget renders a vertical timeline (subtle fuchsia rail + node dots) where each row reads `<label>  →  <choice>` with the rationale below in a smaller caption. Same-day timestamps show as `HH:MM`; older entries collapse to `MMM D`. Auto-fire chat-card; advisory not pinnable.

Helps two cases: (1) the user wants to retrace reasoning without re-reading the whole conversation; (2) the user is reviewing a built persona later and wants to know why a specific choice was made. Constitution bumped to v15.

### Cross-session persistence

The dispatcher auto-persists every `show_decision_log` entry into a new `companion_design_decision` SQL table in the user db (additive schema, no migration of existing rows). One row per `{label, choice, rationale}` entry; `persona_context` defaults to the `intent` field of the card so future queries can filter to "decisions about persona X" or "decisions about this build session". Rows are immutable — to "correct" a decision, Athena emits a fresh `show_decision_log` with the updated entry; the original stays put so retrospective analysis sees the actual sequence of choices.

Retrieval surface: `companion_list_design_decisions(personaContext?, limit?)` Tauri command — frontend can list everything Athena's ever decided, or scope by context. The widget header shows a small "Saved" badge so users know persistence is active.

The Companion plugin page exposes a **Decisions** sub-tab (`sub_decisions/DecisionsPanel.tsx`) with an "Atlas" layout (2026-06-10 redesign): a left rail lists every `persona_context` with its decision count ("All contexts" on top), and the reading pane renders the selected context as one spacious timeline thread — decision label as an uppercase kicker, the choice as a full-contrast headline, the rationale as body text. A filter input above the rail still server-side scopes the query; the data/filter/group contract lives in `sub_decisions/useDesignDecisions.ts`. Rows are immutable in the UI — to "correct" a decision the user asks Athena to re-emit a `show_decision_log` with the updated entry; the original stays put.

**Auto-scope to active build intent.** When the user is mid-build, `UnifiedBuildEntry` mirrors the intent textarea into the system store's `activeBuildIntent` slot. On first mount, the Decisions panel snapshots that slot and pre-fills its filter with it — and renders a fuchsia "Currently designing: …" banner above the filter input with a "Show all" affordance that clears the filter and the slice. Clears automatically on successful build launch (the slot resets to null in `handleLaunch`'s success branch). State is not persisted (session-scoped UI affordance — surprising to resume across app restarts).

## `show_persona_ready` chat-card — design → build closer

The end-of-design recap. Athena emits `show_persona_ready { intent, summary, recommended_action }` after she's worked the user through the design decomposition (walkthrough → use_cases → triggers → tier → observability) and there's enough decided to commit.

`summary` carries the refined intent line plus optional rollups of system prompt outline, use case labels, trigger labels, model tier, and observability plan one-liner. `recommended_action` picks the primary button shape:

- `interactive` (default) — fires the prefill flow with `autoLaunch=false`; user lands in `UnifiedBuildEntry` with the intent filled in and drives the build through the standard gate flow.
- `build_oneshot` — same prefill but `autoLaunch=true` + `mode=one_shot`; Athena will decide everything and ping when done.
- `use_template` — skip prefill, route to the template gallery; Athena should have already named the recommended starter in her chat reply.

Widget renders an emerald-accented card with a "Refined intent" lead-in box, optional rows for each summary field that's populated, a contextual hint string, and a primary button. Closes the design → build loop without requiring an explicit handoff message. Constitution bumped to v16.

## `show_design_capabilities` onboarding card

The design-family has eight chat-card ops (walkthrough, template suggestions, use_case_set, trigger_set, model_tier_choice, observability_plan, decision_log, persona_ready). For new users that's a lot of vocabulary to discover by accident. The `show_design_capabilities` op surfaces all of them as a single onboarding card with one-line descriptions and example "Try: …" prompts.

Op carries only an optional `intro` line Athena composes for context (e.g. "Here's what I can help you design today — pick whichever angle fits where you are."). The capability list itself is hardcoded in the widget so users get a true picture of what's available, not a model-generated (and potentially hallucinated) list.

When adding a new design-family op, mirror the addition in `DesignCapabilitiesWidget` so onboarding stays current. Constitution bumped to v17.

## `show_recent_decisions` compact recall chip strip

Lighter cousin of `show_decision_log`. Athena emits `show_recent_decisions { persona_context, limit? }` when she wants to remind the user of prior choices without derailing into a full audit-trail render. The widget fetches via `companion_list_design_decisions` on mount and renders 1-5 chips of the shape `<label> → <choice>` (no rationale, no timeline). Renders nothing if the fetch comes back empty — softer than the full DecisionLogWidget; shouldn't hold a slot with an empty state.

Constitution bumped to v18. With this, Athena has two complementary surfaces for recalling design decisions: heavy (`show_decision_log` for a deliberate audit-trail render) and light (`show_recent_decisions` for a glanceable "by the way…" reminder).

## `show_fleet_plan` — the editable multi-session plan card (conversational dispatch)

The path from a sentence to running terminals. Athena emits
`show_fleet_plan { operation_intent, rows: [{ cwd, objective, skill? }], title? }`;
the dispatcher validates it and pushes a `fleet_plan` chat card;
`AthenaFleetPlanCard` renders it in the chat with every row editable (objective,
skill) and removable; **Confirm** calls `companion_dispatch_fleet_plan`, which
re-validates and hands off to the existing executors. Nothing spawns before that
click, and **Cancel** dismisses the card with no side effect at all.

- **One row → `fleet_spawn`** (a single session). **Two or more → `fleet_dispatch`**
  (one Operation with N role sessions, `role = <skill>` or `plan-<n>`).
- **Validation happens at the door**, in `dispatcher.rs`, so a card that renders
  is a plan that can actually run: non-empty bounded `operation_intent`; 1-8 rows
  (the `fleet_dispatch` cap); a non-empty bounded objective per row; a slug-shaped
  optional skill; and every `cwd` inside a registered dev project via the shared
  `validate_fleet_cwd_in_db`. A rejected plan produces a dispatcher warning Athena
  reads on her next turn and the op line is stripped from the reply. If the project
  registry is not reachable for that turn the arm **fails closed** — no card.
- **Per-row `label`, `model` and `effort` (all optional).** `label` is the
  operator-facing session name and **wins over the auto-naming** — eight
  sessions all reading `athena · personas` tell you nothing about which is
  which, and the plan's author is the one who knows. `model` and `effort`
  become `--model <id>` / `--effort <low|medium|high|xhigh>`, the same flag
  vocabulary the headless lane uses (`engine/prompt/cli_args.rs`), so a cheap
  survey row and an expensive build row can sit in one plan. All three are
  validated at PROPOSAL time like every other field (bounded; effort against a
  fixed set; a model value that starts with `-` or contains whitespace is
  refused, because these become command-line tokens). `--effort` is registered
  in `fleet::naming::VALUE_FLAGS` — without that its value would be read as the
  task prompt and become the session title.
- **Argv is backend-owned.** A row contributes its flags (if any) and then
  exactly one positional token: the objective, or `/<skill> <objective>` when a
  skill is chosen. The prompt is always LAST.
  `fleet::pty::spawn_session` appends the variadic `--mcp-config` *last*, after
  the caller's args; anything emitted after it would be swallowed as a config
  path, so no caller assembles flags.
- **Typed and spoken requests are the same path.** Voice reaches `send()` through
  `useHoldToTalk` → `setVoiceTurnRequest`, so "get three agents on the flaky
  tests" spoken out loud produces the same plan card as the typed version.
- The card is CHAT-only by design (the full-information dimension). It is
  deliberately not a cockpit widget and not pinnable: it is an actionable
  proposal that starts real processes, so it must not be re-rendered outside the
  conversation that consented to it.

### Durable chat-cards — actionable proposals survive a refresh

Chat cards used to be one-shot Tauri events into a non-persisted Zustand array,
cleared on the next send and on reset. For informational kinds that is the
intent. For **actionable** kinds (`fleet_plan`, `ship_milestone`) it was data
loss: the plan JSON is stripped from the assistant text before the episode is
persisted, so once the array was cleared — by the next message, a panel reset,
or a dev refresh — the proposal was gone with no way back. An Aug 2026 session
lost six dispatched builds that way.

- **A row before the event.** Actionable cards get a `companion_chat_card` row
  (`id`, `conversation_id`, `episode_id`, `kind`, `title`, `config_json`,
  `status`, `result_json`, timestamps) written *before* `CHAT_CARDS_EVENT` is
  emitted, and the row id rides in the payload. Persistence failure degrades to
  the old transient behaviour rather than dropping the card.
- **Status is `pending → dispatched | dismissed | superseded`**, and
  `dispatched` is terminal — its sessions are real, so it can never be walked
  back. `companion_list_chat_cards(conversation_id, pending_only)` and
  `companion_resolve_chat_card(id, status, result_json)` are the read/write
  surface.
- **Dispatch is idempotent.** `companion_dispatch_fleet_plan` takes an optional
  `card_id` and CLAIMS it (`pending → dispatched`, single SQL update) before
  anything spawns. A double-click, a replayed event, or a re-mounted card is
  refused with a clear message instead of starting a second fleet. Validation
  errors happen before the claim (safe to retry); a dispatch that fails outright
  releases the claim.
- **Hydration and the recovery strip.** On mount and on every conversation
  switch the panel merges that thread's pending cards back into the transcript
  (live entries win on id), labelled *"Waiting on you from an earlier turn"* so
  an older unanswered proposal is not mistaken for this turn's. Clearing on send
  now only clears informational kinds.

## `show_ship_milestone` — the editable milestone card (conversational ship planning)

The same contract as the plan card above, aimed at the Ship layer. Athena emits
`show_ship_milestone { project_slug, name, goal, rows: [{ item_kind, item_id, description? }], title? }`;
the dispatcher validates it and pushes a `ship_milestone` chat card;
`AthenaShipMilestoneCard` renders it with the name, the goal and every item's
reason line editable and every item removable; **Create** calls
`companion_create_ship_milestone`, which re-validates and then goes through the
ordinary `create_milestone` + `set_milestone_item` repo functions. Nothing is
written before that click, and **Cancel** dismisses the card with no side effect.

- **Validation happens at the door**, against the real registry: the
  `project_slug` resolves to a `dev_projects` row (id, exact name, or name
  substring); every `item_id` resolves to a use case or goal **belonging to that
  project** (a use case matches on id / slug / name, a goal on id / title); the
  caps mirror the plan card's (`SHIP_MILESTONE_MAX_ROWS = FLEET_PLAN_MAX_ROWS` = 8
  items, 300-char name, 1200-char goal and per-item description); and a duplicate
  member is refused rather than silently merged by the upsert. A rejection names
  the **real candidate ids**, so it doubles as the discovery path — Athena reads
  it on her next turn and re-proposes grounded instead of guessing again. If the
  project registry is not reachable for that turn the arm **fails closed** — no
  card, and a warning telling her to say so.
- **Use cases and goals only.** `dev_milestone_items.item_kind` is
  CHECK-constrained to those two, and the constitution states the reason: a KPI
  is the outcome layer *above* a milestone (the milestone is the work, the KPI is
  the number that moves when it lands), so KPIs are never members of a cut.
- **Born `planned`.** Creation passes no status at all: `create_milestone`
  refuses `shipped` outright, and `active` would stamp `cut_at` and freeze scope
  the operator has not agreed to. Cutting and shipping stay transitions the Ship
  tab owns.
- **Re-validated on confirm**, because the rows arriving are the USER-EDITED
  ones. A backend refusal renders inside the card (`athena-ship-error`) instead
  of the card claiming a milestone appeared.
- Chat-only and **not** in the cockpit widget registry, for the same reason as
  the plan card: an actionable proposal that writes must not be pinnable.

Constitution bumped to **v48**. Test ids: `athena-ship-card`,
`athena-ship-row-<i>`, `athena-ship-confirm`, `athena-ship-cancel`,
`athena-ship-error`.

### Containment posture (2026-08-04, operator's explicit call)

`fleet_spawn` and `fleet_dispatch` are now on `AUTOAPPROVE_ALLOWLIST`, so they
follow the boldness dial like the other fleet actions. Stated plainly: **with the
default `Bold` dial in autonomous mode, a typed or spoken request can start real
`claude --dangerously-skip-permissions` sessions with no click in between.** The
risk is accepted; an assistant that cannot start work is not a conductor. Two
things bound it and neither may be weakened:

1. `validate_fleet_cwd` confines every spawn to a **registered dev project**
   directory. That is the boundary.
2. The editable plan card is the **correction path** — for anything beyond a
   single obvious session, the constitution directs Athena to propose a plan the
   user can edit rather than a bare auto-firing spawn.

Cautious and Balanced dials keep gating these behind the confidence matrix.

**Every dispatch is audited.** Because a request can start terminals with no
click, the durable record is the compensating control — a log line is not
auditable after the fact. Confirming a plan appends a row to the same
`fleet_decisions` ledger the autopilot writes to, carrying the operation intent,
the session count, and per row the cwd plus the **resolved prompt** that session
received (skill included). Origin is distinguishable: `decision_class =
operator_confirmed_plan` and `outcome = operator_confirmed` /
`operator_confirmed_failed`, versus the autopilot's `auto_fired` / `deferred`. A
confirm whose executor errored is recorded too, since a half-failed dispatch
still started something. The ledger write is best-effort and can never fail a
dispatch.

## Slash-command palette

Typing `/` as the first character of an empty draft opens a small popover above the composer with a set of preset prompts (`SlashPalette.tsx`): **get to know me** (re-run the intake interview — F2), show goals, what's queued, recent decisions, live ops, memory recap, capabilities. Subsequent keystrokes filter the list by case-insensitive substring on label or key; ↑/↓ navigate; Enter picks; Esc clears the draft and closes. Click works the same as Enter. Preset messages are i18n'd so non-English users get prompts in their own locale — Athena handles all 14 supported languages in chat.

The Send button stays disabled while the palette is open so typing `/` then Enter goes through the palette path (pick the active preset) instead of submitting the literal `/` as a chat message.

## Refine chips

Below the latest completed assistant bubble only, `RefineChips` renders three small affordances — **Shorter**, **More detail**, **Code only** — that resend the prior user message with a localized steering suffix appended ("— much shorter, please.", "— go deeper, with examples.", "— code only, minimal prose."). Click feeds the modified prompt through the same `send()` path used by the composer, so the optimistic-bubble / streaming / TTS pipeline kicks in identically. Disabled while streaming or improving. Older bubbles in scrollback don't render chips — refining a mid-scrollback turn is a different, higher-effort UI that needs to model "which user message do I resend?" carefully.

## On-demand read-aloud (per assistant bubble)

When voice is configured for the user's chosen engine (resolved via `useTtsVoiceSelection` — each engine needs its own voice id), a small `BubbleReadAloud` button renders below the latest completed assistant bubble. Click → synthesizes the message via the existing `companion_tts` IPC, plays through a transient `<audio>` element, swaps to a "Stop" affordance during playback, and reverts to idle on end so the user can replay. Independent of the main TTS pipeline (which fires automatically when `voiceEnabled` is on) — this is for the "I didn't have voice on, but I want to hear what Athena just said" path. Skipped when no engine is configured to avoid hitting the backend just to surface an error.

## Voice

Voice playback dispatches to one of two engines, picked by the user in the Voice tab's engine selector: **Kokoro** (primary) or **Pocket TTS** (experimental, voice cloning). The slice persists `companionVoiceEngine: 'kokoro' | 'pocket_tts'`; per-engine voice ids live in `companionKokoroVoiceId` / `companionPocketVoiceId`. Playback call sites resolve the active identity through `useTtsVoiceSelection()`. The earlier **ElevenLabs** (cloud, credential-gated) and **Piper** (per-voice ONNX download) engines were descoped 2026-07-10 — two local engines cover the quality-vs-cloning space with no cloud bill; persisted pre-descope engine selections normalize onto Kokoro (`normalizeCompanionTtsEngine`). The Twin plugin's ElevenLabs-based voice-profile tab was descoped in the same pass (readiness is now five milestones); the ElevenLabs vault *connector* survives for other uses (e.g. Artist transcription).

Backend code lives under `src-tauri/src/companion/tts/` with one submodule per engine; `commands/companion/voice.rs` is a thin dispatcher that validates input (text length, voice-id format) and routes to the right impl.

**Chat streaming.** The streaming bubble no longer renders the raw token-by-token text (it reflowed and leaked machine grammar). During a turn it shows a single status line plus the `OperationalThread` checklist; the full prose reply lands in one piece when the turn finishes. The status line is deliberately **generic** ("Working…"): `extractStreamPhase` still parses the CLI's phases and `phaseLabel` still exists, but the chat no longer names the tool she is running — naming it was one of four simultaneous progress readouts and the least actionable. The inline **Stop reply** control sits beside the typing dots. When voice is active, a short spoken **ack** (~2.5s in) and **heartbeat** (~30s in) fill dead air and are cut off the moment the real reply plays. Athena can also narrate long turns with her own `PROGRESS:` beats — each completed beat shows in the bubble (outranking the derived phase), is logged into the narration timeline, and is spoken live, suppressing the generic ack/heartbeat. The `PROGRESS:` grammar is **always-on** (its own `progress_addendum()` in `prompt.rs`, appended unconditionally — only the `TTS:` grammar that shares the same prompt slot is voice-gated, so text-only users and proactive turns narrate too; D1). Beats aren't discarded from history: `dispatcher.rs` strips them from the *final reply* and captures them in order, then `session.rs` re-persists each as its own lightweight **append-only assistant episode** (prefixed with the `PROGRESS:` sentinel that `Bubble.tsx` renders as a dim aside) — so the transcript keeps the progressive back-and-forth instead of collapsing to one block. They carry no embedding (conversational texture, not memory-worthy facts). This is all three variants (A + B + C) plus the D1/D2 follow-ups from [`conversation-orchestration.md`](./conversation-orchestration.md).

**Voice controls popover.** The chat toolbar's audio button (`VoiceControlPopover`, shown when the active engine is configured — `useTtsVoiceSelection().configured`) opens a popover with: enable/disable spoken summaries, a **volume** slider (`companionVoiceVolume`, default 0.5, applied to every TTS `<audio>` in `voicePlayback.play()` — and **live**: `play()` subscribes to the store so dragging the slider changes Athena mid-sentence; the same slider is mirrored in the Voice tab's engine card), and a **Test voice** button that synthesizes + plays a sample sentence so the user can hear the current engine/voice/volume on demand.

**Settings UX.** All Voice/Setup section headers use a themed (`text-primary`) `SectionCard` title and every dropdown uses the shared `ThemedSelect` (theme-aware) rather than a raw `<select>`. The only per-call tuning left post-descope is speech rate (`companionVoiceSpeed`); everything else inherits engine defaults. Speech-to-text setup lives in the same tab via `SttPanel`.

### Kokoro (local, higher quality)

Higher-quality local synthesis via the **Kokoro-82M** model run through the **sherpa-onnx** sidecar (`tts/kokoro.rs` + `tts/kokoro_catalog.rs`). Same subprocess-isolation rationale as Piper — the sherpa build ships its own `onnxruntime.dll` next to the exe and loads it in a separate process, so it can't collide with our pinned in-process `ort 2.0.0-rc.9`, and it bundles espeak-ng phonemization. Kokoro sounds noticeably more natural than Piper (community consensus rates it near ElevenLabs); it currently ships English voices only. Two preconditions, both surfaced by `companion_tts_kokoro_status` and rendered as a setup card:

1. **Engine binary** — `sherpa-onnx-offline-tts(.exe)` (plus its sibling `onnxruntime*.dll`) in the shared `~/.personas/companion-tts/bin/` dir (or `PERSONAS_KOKORO_BIN`, or PATH). Sourced from the sherpa-onnx `shared-MT-Release` bundle (there is no `static` build). **Kokoro and Pocket TTS share this one binary**, so its version + architecture are owned centrally by `tts/sherpa_engine.rs` (`ENGINE_VERSION`, arch-aware archive URL, shared `extract_engine`). The pin is **≥ v1.13.4** — the first release carrying Pocket TTS support; dropping below it silently breaks voice cloning through the shared exe. A unit test asserts the URL tracks both `ENGINE_VERSION` and the compiled `target_arch`.

2. **Model package** — extracted into `~/.personas/companion-tts/kokoro/`: `model.onnx` (~310MB) + `voices.bin` (~26MB) + `tokens.txt` + `espeak-ng-data/` (~18MB), from the sherpa-onnx `kokoro-multi-lang-v1_0` release. Unlike Piper (one `.onnx` per voice), Kokoro is one monolithic model; all voices are selected by an integer `--sid`.

**One-click install (`companion_tts_kokoro_download`, `tts/kokoro_installer.rs`).** On Windows (`can_auto_install`; the sidecar archive is selected per `target_arch`, win-arm64 or win-x64), the setup card's **Download & install** button streams both `.tar.bz2` archives, then extracts them on a blocking task via the pure-Rust `bzip2` + `tar` crates — selectively: the sidecar exe + its `*.dll`, and the English model subset (skipping the Chinese `dict/`/`lexicon-zh`/`*-zh.fst` to trim footprint). Progress + terminal states stream on the `companion://kokoro-install` event channel; on completion the card re-checks status and flips the Installed badges live. The manual drop-in path (below the button) stays as a fallback and is the only path on non-Windows.

**Footprint / resource cost.** Nothing is bundled into the Personas installer — the sidecar + model download to `~/.personas` at *runtime*, so the shipped installer is unchanged (adding `bzip2`+`tar` adds only a few KB to the binary). Installed on disk it's **~400MB** (model 310MB + voices 26MB + espeak-ng-data 18MB + sidecar & ORT DLL ~18MB) vs a Piper voice's ~61MB. At runtime each synthesis spawns a fresh sidecar that loads the ~310MB model (transient peak, freed when the subprocess exits — no persistent RAM cost), synthesizing at RTF ~0.4 (~2.5× real-time) on a typical desktop with a ~1–1.5s cold model-load per call. The trade is real: ~400MB disk + heavier per-call load for the quality jump.

The curated voice list (`KOKORO_VOICES`) currently surfaces a single voice — `af_heart` = sid 3, Kokoro's warm English default — mapped to its sid via `companion_tts_list_kokoro_voices`; the model is monolithic (every voice is baked into the one `voices.bin` regardless), so the catalog is purely the picker, not a size lever — add rows there with verified sids to expose more. The Voice tab renders a **Preview ▶** button that synthesizes a sample sentence through the same `companion_tts` path Athena uses. Synthesis spawns the sidecar with `--kokoro-model/-voices/-tokens/-data-dir --sid <n> --output-filename <tempfile>` and the text as a positional arg (not stdin, unlike Piper); the result is 24kHz `audio/wav` base64. Concurrency is capped by the same `companion_tts_semaphore` Piper uses.

### Pocket TTS (local, voice cloning)

The experimental engine (`tts/pocket.rs`) is the only local one with **zero-shot voice cloning** — Athena can speak with a voice built from a ~16-second recording of the user. It wraps [kyutai's Pocket TTS](https://github.com/kyutai-labs/pocket-tts) (100M-param, CPU-only PyTorch), which has no self-contained sidecar binary; instead of a subprocess-per-call, the engine talks HTTP to a **long-lived local service** (default `http://127.0.0.1:8080`, override `PERSONAS_POCKET_TTS_URL`) that keeps the model warm. Same out-of-process rationale as Piper/Kokoro — a separate process can't collide with our pinned in-process `ort 2.0.0-rc.9` — with the added benefit that repeated syntheses skip the model reload entirely.

The service is the ElevenLabs-API-shaped wrapper from the pocket-tts repo (`service/app.py`): a bounded worker pool + admission queue that answers 429 under overload, which `pocket::synthesize` maps to a user-facing "at capacity" message; no client-side semaphore is used (unlike Piper/Kokoro), since backpressure lives server-side. `companion_tts_pocket_status` probes `/health` (the Voice tab gates the engine behind a running/not-running card with the service address); `companion_tts_list_pocket_voices` returns the service's voices — the user's cloned `.safetensors` embeddings (category `cloned`, listed first with a badge) plus the built-in Kyutai catalog (`premade`). Dropping a new embedding into the service's `voices/` dir and re-checking makes it selectable. Result is 24kHz `audio/wav` base64, same as Piper.

**Packaged sidecar mode (the shippable default).** sherpa-onnx ≥ v1.13.4 runs Pocket TTS natively — the SAME `sherpa-onnx-offline-tts` binary Kokoro uses — so the engine also works with zero Python via a one-shot subprocess spawn: the 7-file int8 ONNX package (~190MB, `~/.personas/companion-tts/pocket/`) + `--reference-audio=<wav>` for the cloning. Any `<name>.wav` dropped into `~/.personas/companion-tts/pocket-voices/` becomes a cloned voice (`pocket::list_local_voices`), synthesized fully offline in ~3s including model load. One-click install mirrors Kokoro (`pocket_installer.rs`, `companion_tts_pocket_download`, progress on `companion://pocket-install`) and is **arch-aware** — win-arm64 hosts get the native aarch64 sidecar, x64 hosts the x64 one, both pinned to v1.13.4.

**Routing.** A synthesis goes to the sidecar when it's installed AND the voice exists as a local wav; otherwise it falls back to the HTTP service (which contributes the built-in Kyutai catalog to the merged `companion_tts_list_pocket_voices` and keeps the model warm for faster repeated playback). Either backend alone is sufficient; nothing ships in the Personas installer itself (same runtime-download posture as Kokoro).

**Self-serve cloning (upload).** The Voice tab's "Add your voice" block (Pocket engine only) accepts any decodable audio file: the webview converts it via the Web Audio API (`audioToReferenceWav.ts` — decode mp3/wav/flac/ogg → resample to 24kHz mono PCM16 → trim to 30s) so the Rust side needs no audio decoders, then `companion_tts_pocket_import_voice` validates the RIFF container + a 10MB cap and writes it into pocket-voices/ via temp+rename (no truncated references on crash). The new voice is auto-selected. Cloned rows carry a delete affordance behind a danger `ConfirmDialog` (`companion_tts_pocket_delete_voice`, idempotent); the manual drop-a-wav-in-the-folder path still works alongside.

**License caveat.** The prebuilt ONNX package derives from a community export (KevinAHM/pocket-tts-onnx) licensed **non-commercial** — fine for personal use; re-export from the original Kyutai weights before any commercial distribution.

## Voice input (speech-to-text)

Athena's hold-to-talk (footer + orb) routes through `useSpeechInput`, which picks the engine from `companionSttEngine`:

- **`browser`** (default) — the Web Speech API in the renderer (`useDictation`). Zero setup, but on WebView2 the audio is forwarded to the OS vendor's cloud STT (disclosed in the Voice tab).
- **`whisper`** — on-device transcription via a sidecar `whisper-cli` binary (`useLocalDictation`). The mic is captured through an `AudioContext` pinned to 16 kHz mono, encoded as a WAV in the renderer, and sent to `companion_stt_transcribe` — audio never leaves the machine. It's batch (no live interim), so `listening` stays true through the transcription round-trip to preserve the hold-to-talk contract.

Backend lives under `src-tauri/src/companion/stt/` mirroring the Piper TTS layout: `whisper.rs` (sidecar lookup `PERSONAS_WHISPER_BIN` → `~/.personas/companion-stt/bin/` → PATH; spawns `whisper-cli -m model -f wav -nt -np [-l lang]`), `catalog.rs` (curated ggml model allowlist), `downloader.rs` (atomic `.partial` download from `ggerganov/whisper.cpp`, progress on `companion://stt-download`). Commands: `companion_stt_transcribe`, `companion_stt_list_models`, `companion_stt_download_model`, `companion_stt_delete_model`, `companion_stt_engine_status`. The Voice tab's `SttPanel` exposes the engine selector, install status, and model browser. **Two preconditions for the local engine** (same UX as Piper TTS): a `whisper-cli` binary at `~/.personas/companion-stt/bin/`, and a downloaded model.

**Why subprocess (same rationale as Piper):** users can swap newer whisper.cpp builds without recompiling, and the engine's ggml/BLAS stack stays in its own process.

## Dev mode — the self-development loop (`dev_improve` / `dev_merge`)

> Supersedes the old composer wrench-send self-improve loop (2026-07-04). Full direction + build log: [`docs/tests/athena/dev-mode-direction.md`](../../tests/athena/dev-mode-direction.md).

**Toggle:** the wrench in the chat-panel header, next to the autonomous Infinity icon — rendered only in **debug builds** (`companion_beta_flags → devModeAvailable`) and persisted both in Zustand (`companionDevMode`) and server-side (`companion_dev_mode` row via `companion_set_dev_mode`; `chat::dev_mode_enabled` hard-gates on `cfg!(debug_assertions)` so a release build ignores the row).

**What it does:** with dev mode on, Athena's prompt gains a DEV MODE addendum (`companion/dev_mode.rs::addendum_if_enabled`, riding the mode-addenda slot): the self-model ("you run from your own source checkout — the app, including you, is built from this repo"), the **context-map index** (a group-level rollup: one line per group listing its context slugs, descriptions dropped — the per-context format hit ~30KB at 208 contexts; the session reads `context-map.json` itself for details), judgment rules (product action vs code change; ask one clarifying line when ambiguous), and two ops:

- **`dev_improve { request, context, files_hint, backend, confidence, rationale }`** — dispatches **one coding CLI fleet session** at the repo (visible Fleet tile named `athena-*-dev`, operative-memory op, containment via `validate_fleet_cwd` — the repo must be a registered Dev Tools project). The task prompt is assembled **Rust-side** with the resolved context's `file_paths` from the map — never model-recalled paths. Workspace policy: `backend: false` (frontend-only) runs in the **main checkout** and edits hot-reload immediately; `backend: true` (any Rust) runs in an **isolated worktree** (`.claude/worktrees/athena-dev-<id>`) so the running app is undisturbed. Default is `true` — the safe side.
- **`dev_merge { op_id, force? }`** — the **merge handshake** for backend runs (`dev_mode.rs::apply_dev_branch`). The rule it now obeys: **never lose a commit, and never claim one landed without checking.**
  - **Already applied is a success, not a failure.** Before choosing a strategy it runs `git cherry HEAD <branch>`; if every branch commit is patch-equivalent to HEAD (a parallel session landed the same change on master first) it reports "already applied upstream" and cleans up. The same case inside a single-commit pick — git's `The previous cherry-pick is now empty` — is `--skip`ped and reported as applied. Previously both paths came back as a total failure over content that was safely on master.
  - **Strategies:** fast-forward when master is unmoved; **cherry-pick** when the branch is exactly one commit ahead of a moved master; **`git merge --no-ff`** for multi-commit divergence (the old code refused outright and stranded whole runs). Conflicts are **never** auto-resolved — the pick/merge is aborted, the live checkout is left untouched, and the refusal names the intact branch tip.
  - **Post-verification before any report and before any prune.** Success requires the branch tip to be an ancestor of HEAD *or* no branch commit to remain unapplied (`git cherry`, which is the only test that survives a cherry-pick's sha rewrite). Failing that, the merge is reported as failed and **the worktree and branch are left in place on purpose**. Cleanup only ever runs after verification passes, and every refusal path prints the branch tip sha so a commit can never be stranded behind a pruned worktree.
  - The **verified landed sha** is stamped on the `companion_dev_op` row (`mark_dev_op(..., "merged", Some(sha))`). Before this, "merged" was recorded with no sha at all.
  - **Live-sibling guard.** A dev session is a PTY child of this app, so the rebuild a merge triggers kills every other in-flight dev session mid-run, uncommitted work included. The merge now refuses while other `athena-dev*` sessions are live, naming them; `{"force": true}` is the explicit "take them down with it".
  - Node-tooling **lockfile drift** (`pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`) is still restored to HEAD before the dirty-tree check.

**Policy (hard):** neither op is on `AUTOAPPROVE_ALLOWLIST` — **dev-mode operations never auto-fire in any mode**; each dispatch and each merge is an explicit approval click. And **every dev op ends in a reflection**: on session exit, `reconcile_if_dispatched` routes dev ops to `spawn_dev_reflection` — a chat-visible `dev_improve_review` proactive turn carrying the op wrap-up + fresh git evidence (`git log --stat`, tree dirtiness) where Athena reviews what changed vs what was asked, flags risk, and recommends (or argues against) the merge.

**Durability + the experiment ledger.** Every dispatch is a durable `companion_dev_op` row (user db; status `dispatched → completed | closed → merged`, `interrupted` for orphans). It survives the app restart that a backend merge inherently causes: the reflection reconciler, the `dev_merge` handshake, and **boot recovery** all read it. Boot recovery no longer just writes an op off: when an interrupted BACKEND op's worktree still holds uncommitted work (and dev mode is on), it stages those paths explicitly, commits them with a `[recovered] …` message that says plainly it was assembled by the recovery pass and not reviewed by the session, and flips the row back to `completed` so the **ordinary** `dev_merge` handshake picks it up — no bespoke recovery path. Ops with nothing to save still sweep to `interrupted`. Either way one proactive card describes exactly what survived on disk. The same table doubles as the **experiment harness** the panel surfaces while dev mode is on — a compact **dev-op ledger** strip (`DevOpLedger.tsx`, `companion_dev_op_ledger`) with the aggregate scoreboard (dispatch→commit rate, merges, rescues) and a **👍/👎 verdict chip** per run (`companion_dev_op_set_verdict` → `user_verdict`, gated on dev mode like the ledger read) — the signal that, over days of use, tells whether dev mode is earning its keep. The dispatch card prints the **full `op_id`** — `dev_merge` looks the op up by exact match, so the displayed id must round-trip into the merge handshake.

**Self-review — closing the meta-loop.** The 👍/👎 verdicts used to accumulate and feed back into nothing. A `ScrollText` button on the ledger strip (`companion_dev_op_self_review`, `commands/companion/dev_review.rs`) now spawns **one** proactive turn over Athena's own track record: the aggregate scoreboard plus the last 15 dispatches rendered as evidence (status, backend/frontend, commit, verdict, a 90-char request digest). The directive asks her to find the *shared property* of the runs that landed versus the ones that were interrupted or drew a 👎, write 1 to 3 `write_procedural` memories citing the op ids they came from, and optionally propose **at most one** `dev_improve` at her weakest pattern — which stays an approval card like every other dispatch. Hard rules in the directive: never mark a goal done, never write or change a verdict (the verdict is the operator's signal about her and would be worthless if she could write it). **Manual trigger only** — there is deliberately no scheduler, cron, or periodic pass behind it, and no new table: the ledger already holds everything. Gated loudly (`require_auth_sync` + `dev_mode_enabled`, refusing rather than returning an empty payload, because it spawns a real turn), and refuses on an empty ledger.

## Dev-build extras: conversation log export + daily goals

Two debug-build-only surfaces (gated on `companion_beta_flags → devModeAvailable`, independent of the wrench state):

- **Conversation log export** — a `FileDown` header button (`DevConversationLogButton.tsx`, next to the wrench) that dumps the active conversation to the gitignored `logs/athena-conversations/<stamp>-<conversation>.md` at the repo root for reflective development. The markdown joins messages with the side channels keyed by assistant episode id (store-live plus anything hydrated from the turn-sidecar rows, so pre-restart turns keep theirs): the narration/tool trail, the TodoWrite plan, turn-summary rollups, recall previews, and the autonomous-actions ledger (pure serializer `devConversationLog.ts`; writer `commands/companion/debug_export.rs`, `#[cfg(debug_assertions)]`). The success toast carries the absolute path for 30 s. The export dumps the **full** conversation: it takes the newest 500 and then walks `companion_list_messages_before` back to the first turn (`fetchAllOlderMessages`), and batch-reads sidecars for every assistant message in the dump so pre-restart turns keep their side channels.
- **Daily goals (gamification ritual)** — a subheader bar (`DailyGoalsBar.tsx`, under the dev-op ledger slot) with a flame **streak counter** (consecutive days with all goals accomplished) and the active set of up to 3 goal chips. Evaluation is strictly **manual**: the operator toggles each chip; when the last one lands, the set clears after a short celebratory beat and the streak grows. A set can be discarded (never counts). Data lives in `companion_daily_goal` (user db; completed rows kept as history, streak recomputed per read with local-day keys and a today-incomplete grace, `brain/daily_goals.rs`). Athena sees the active set + streak via a prompt addendum with a hard rule: she may reference and encourage, but never marks or proposes marking a goal done.
  - **Reading and editing a goal.** Chips stay one line, so a long goal ellipsizes. The full text lives in two places: a hover tooltip on the chip, and the **pencil** button, which opens the same modal used to author the set, prefilled — `companion_daily_goals_update` rewrites the texts of the active set. Filling a free slot there appends a goal (3 max); clearing an existing one is refused, because dropping the last open goal would leave a set that is logically complete but never stamped. Marking done or discarding the set remain the only ways out, and an edit never changes done state. Fields are textareas rather than inputs precisely so the whole goal is readable at once.

## Live browser testing (`run_browser_test`)

Athena can run a **live browser test** of a web app the user is building — the products of this app's Dev Tools projects — driving a real browser, walking the scenario, and reporting defects back into chat. The capability is the Athena-side counterpart to a QA engineer.

### The op

`run_browser_test { project_name? | url?, scenario }` is **approval-gated** (`ALLOWED_ACTIONS` in `dispatcher.rs`, `execute_run_browser_test` in `commands/companion/approvals.rs`) — twice over: it spawns a CLI reasoning turn (cost), and that turn drives a real browser (clicks/navigation/input on the user's machine). On approval the executor resolves the target URL (an explicit `url`, or the resolved Dev Tools project's `test_env_url`), registers the **approved origin** with the bridge, and spawns a proactive turn with `trigger_kind = "browser_test"`. Constitution **v32** teaches the op; **v33** adds the report card + screenshot-verification guidance.

That trigger kind is what makes `companion/session.rs::run_cli` hand the single CLI spawn a browser-tools MCP server via `--mcp-config` (browser tools exist for **that turn only** — the directive tells Athena to complete the whole test in one pass, never deferring to a continuation). Two backends:

- **Extension** — the user's real Chrome via the paired bridge + extension (preferred when connected).
- **Playwright** — the bundled `@playwright/mcp` browser (fallback when no extension is connected; the proven first-cut path).

### The browser bridge

`src-tauri/src/browser_bridge/` mounts two routes on the shared `local_http` server (alongside `/mcp/rpc` and `/fleet/hooks/*`):

- **`GET /browser-bridge/ws`** — the WebSocket the Chrome extension connects to. Authenticated by the **pairing token** *before* the upgrade — any web page can open a socket to `127.0.0.1`, so the token (which never reaches page JS) is the gate. Last-connection-wins for MV3 service-worker reconnects; pending requests fail cleanly on disconnect.
- **`POST /browser-bridge/mcp`** — the JSON-RPC 2.0 MCP endpoint the browser-test turn discovers via `--mcp-config`. Tools: `browser_status / navigate / snapshot / click / type / screenshot / console / wait_for / detach`. Every `tools/call` authenticates the per-test session token AND enforces the approved origin **server-side** before relaying to the extension — the model never picks the origin; the approval did.

Policy lives in the bridge (Rust), not the model and not the extension. The extension (`tools/athena-browser-extension/`, MV3) is hands and eyes only: it drives a dedicated test tab it created itself (never the user's existing tabs), captures console/network via `chrome.debugger` CDP, and reads/acts on the DOM via `chrome.scripting`. Pairing config lives in the extension's options page (or a packaged `config.json` for QA harnesses).

### Report card + defects → ideas

A browser-test turn ends by emitting `show_browser_test_report { url, steps[], defects[], console_errors[], security_notes[] }` — a structured verdict chat-card (`browser_test_report` widget, unclamped) instead of prose-only: each step with one line of observed evidence, defects with severity + suggested fix, verbatim console errors, and any prompt-injection / untrusted-content notes. The card carries a **File as ideas** affordance (`companion_file_browser_defects`) that writes each defect into the Dev Tools idea inbox (`dev_ideas`, `scan_type = "browser_test"`, status `pending`) so it flows into the normal [Idea Triage](../dev-tools.md) → Build → agent-fix loop.

### Pairing UX

Companion → Setup surfaces a **Browser testing** panel (`sub_setup/BrowserBridgePanel.tsx`): live "Extension connected" status, the bridge port, the copyable pairing token, and a regenerate button. The token persists in settings (`browser_bridge_pairing_token`) so the extension pairs once and survives restarts; `PERSONAS_BROWSER_BRIDGE_TOKEN` env override wins for QA. Commands: `browser_bridge_status`, `browser_bridge_regenerate_token`.

## Turn usage ledger (`companion_turn`)

Every Claude CLI spawn Athena makes records one durable row in `companion_turn` (companion user DB) so her own resource consumption is finally accountable — until now the CLI's terminal `result` event (carrying `total_cost_usd`, token `usage`, `duration_ms`, `num_turns`) was drained and dropped, leaving Athena able to triage the *fleet's* cost while her own was invisible. Backed by `src-tauri/src/companion/turn_ledger.rs`.

- **Full turns** (`session.rs::run_cli`) record `origin` (`chat` / `autonomous` / `proactive` / `external`), the `trigger_kind` for proactive turns, the model, the parsed usage, a `voice` flag, the linked `assistant_episode_id`, and an `outcome_json` of dispatcher side-effect counts (approvals / cards / navigations / …).
  - `origin = external` covers the frontend surfaces that forward a *synthetic* prompt (`companion_send_message` with a `system_source`): Fleet's **Ask Athena** button and the decision layer's **Explain in cockpit**. The wiring is live end to end, but the origin has **never actually been invoked** — as of 2026-08-07 the reference install had 0 `external` rows *and* zero bare `[Fleet]` / `[decision-explain]` opening episodes, which `send_turn` writes before any CLI failure exit and whose history predates the ledger's. So the zero means "never pressed", not "always failed". Now that failure exits record rows, either outcome lands one and the two stay distinguishable.
- **Headless decision legs** (`athena_reaction.rs::cli_text_tracked`) record `origin=headless` labeled by leg: `exec_triage`, `msg_triage`, `reaction`, `reaction_batch`, `review_resolution` — the highest-frequency autonomous spend, and about 94% of all ledger rows. The two triage legs additionally write their verdict distribution (`drop`/`digest`/`attention`/`deep_dive`, or `parse_failure`) into `outcome_json` via `turn_ledger::update_outcome` after parsing, so the health funnel can report it. A leg that fails or times out records a flagged row instead — see **Failed turns are rows too** below.
- **Failed turns are rows too — on every origin.** A turn that never reached a reply records a row with `is_error = 1`, an `error_reason` token, and the raw message in `outcome_json.error`. One taxonomy (`session::classify_failure`) and one row shape (`turn_ledger::failed_turn_record`) serve every path, so `GROUP BY error_reason` means the same thing wherever the row came from: `timeout` / `timeout_after_stale_resume` / `stale_resume` / `spawn_failed` / `cli_nonzero_exit` / `empty_reply` / `cli_io` / `other`.
  - **Full turns** — `session.rs`'s `send_turn` is a thin wrapper (`FailedTurnCtx`) around the turn body for exactly this: every error exit used to return *before* the ledger write, so `is_error` was 0 on every row ever written and the health panel reported a flawless error rate **by construction**. It covers the CLI failing to spawn, the 25-minute timeout, the stale-`--resume` retry giving up, and the DB / prompt-assembly / embedding `?` exits. `run_cli` mirrors each terminal `result` event into a sink the wrapper can still read after an error or a dropped future, so cost survives where it exists — and a failed turn with unknown cost is still a recorded failed turn. A degraded turn that salvaged partial text (broken pipe, non-zero exit) is flagged too.
  - **Headless legs** — the tracked wrappers in `athena_reaction.rs` (`cli_text_tracked`, `cli_decision_with_model`) record the same way. This matters more than it sounds: `headless` is roughly **94%** of all ledger rows, so covering only the chat path would have moved the health number from "perfect by construction" to "near-perfect by construction" — the same falsehood with a smaller coefficient. Their errors carry no cost, and that is a fact rather than a shortcut: every surviving `Err` exit in `cli_text_inner` fires before the child can emit a `result` event. The untracked `cli_text` / `cli_text_with_usage` (engine `kpi_*` callers) hold no user-db handle and meter themselves into `dev_llm_spend`.
  - **A headless timeout is a failure, not a success.** `cli_text_inner`'s 180-second cap kills the child and returns `Ok` with a partial blob — deliberate, since the triage legs tolerate a short blob and record their own `parse_failure`, but it means a timeout is invisible to an error-shaped check. The tracked wrappers read `HeadlessRun::timed_out` and flag the row (`error_reason = timeout`), keeping whatever cost was captured.
  - **Skips are not failures.** The two turn-lock skips (a background `try_lock` self-skip, a full fleet queue) record nothing — they are backpressure, and counting them would make the number dishonest the other way. `FailedTurnCtx` is armed only after the lock is held, and disarms once a turn writes its own row, so no turn is ever counted twice.
- Capture is **best-effort and never blocks a turn**: a missing/unparseable `result` event records NULL usage; an insert failure is a `tracing::warn!`. Rows prune at 90 days (`turn_ledger::prune_old_turns`, run alongside the background-job prune at `companion_init`).
- **Queryable via** `companion_get_usage_dashboard(days)` (daily + by-action-type + totals) and `companion_get_health(days)` (triage funnel, proactive economy, job health, plus `errors` **and** the `turns` denominator they should be read against) in `commands/companion/observability.rs` — the data layer for the Overview → Activity "Athena lane" and Overview → Observability "Athena health" panels (A3/A4 of `docs/plans/athena-value-expansion.md`). Engine KPI cli_text callers (`kpi_binding` / `kpi_derivation`) still use the untracked `cli_text` and are a follow-up.

## State

`src/features/plugins/companion/companionStore.ts` owns panel state, init status, messages, streaming text, approvals, quick replies, brain viewer cursor, self-improve state, and pending playback. `companionPluginSlice.ts` owns the plugin page tab and persistent plugin-level settings.
