# Brotherhood B1 — Test Coverage & User Scenarios

> Complete `data-testid` coverage and user-centric test scenarios for the Brotherhood plugin.
> All testIds follow established codebase conventions (lowercase kebab-case, `{scope}-{element}-{action}` pattern).
> Scenarios are designed for the existing test automation framework (`localhost:17320`).

---

## data-testid Registry

### Plugin Navigation

| testid | Element | Type |
|--------|---------|------|
| `sidebar-plugins` | Plugins nav button (existing) | button |
| `tab-brotherhood` | Brotherhood plugin tab in sidebar L2 | button |
| `tab-brotherhood-dashboard` | Dashboard sub-tab | button |
| `tab-brotherhood-enrollment` | Brothers sub-tab | button |
| `tab-brotherhood-encounters` | Encounters sub-tab | button |
| `tab-brotherhood-proposals` | Proposals sub-tab | button |
| `brotherhood-page` | Plugin page root container | div |

### Dashboard Panel

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-dashboard` | Dashboard panel container | div |
| `brotherhood-stat-enrolled` | Enrolled brothers count card | div |
| `brotherhood-stat-encounters` | Encounters completed count card | div |
| `brotherhood-stat-fitness` | Total fitness gain card | div |
| `brotherhood-stat-proposals` | Proposals generated card | div |
| `brotherhood-new-encounter-btn` | "New Encounter" quick action button | button |
| `brotherhood-recent-list` | Recent encounters list container | div |
| `brotherhood-recent-item-${id}` | Recent encounter row | div |
| `brotherhood-recent-empty` | Empty state when no encounters | div |
| `brotherhood-pending-list` | Pending proposals list container | div |
| `brotherhood-pending-item-${id}` | Pending proposal row | div |
| `brotherhood-pending-empty` | Empty state when no pending proposals | div |

### Enrollment Panel

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-enrollment` | Enrollment panel container | div |
| `brotherhood-enroll-btn` | "Enroll New Brother" button | button |
| `brotherhood-enrolled-list` | Enrolled brothers list | div |
| `brotherhood-enrolled-empty` | Empty state for enrolled list | div |
| `brotherhood-brother-card-${id}` | Enrolled brother card | div |
| `brotherhood-brother-edit-${id}` | Edit profile button on card | button |
| `brotherhood-brother-preview-${id}` | Preview external view button | button |
| `brotherhood-brother-unenroll-${id}` | Unenroll button on card | button |
| `brotherhood-unenrollable-list` | Non-enrolled personas section | div |
| `brotherhood-unenrollable-enroll-${personaId}` | Enroll button per persona | button |

### Enrollment Dialog

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-enroll-dialog` | Dialog container | div |
| `brotherhood-enroll-persona-select` | Persona dropdown selector | select |
| `brotherhood-enroll-display-name` | Display name input | input |
| `brotherhood-enroll-specialty` | Specialty textarea | textarea |
| `brotherhood-enroll-tags` | Capability tags input | input |
| `brotherhood-enroll-tag-${tag}` | Individual tag chip | span |
| `brotherhood-enroll-tag-remove-${tag}` | Remove tag button | button |
| `brotherhood-enroll-domain` | Domain dropdown | select |
| `brotherhood-enroll-disclosure-silhouette` | Silhouette radio | input |
| `brotherhood-enroll-disclosure-outline` | Outline radio | input |
| `brotherhood-enroll-disclosure-open` | Open radio | input |
| `brotherhood-enroll-disclosure-transparent` | Transparent radio | input |
| `brotherhood-enroll-preview` | Membrane preview panel | div |
| `brotherhood-enroll-preview-toggle` | Toggle preview visibility | button |
| `brotherhood-enroll-cancel` | Cancel enrollment | button |
| `brotherhood-enroll-submit` | Submit enrollment | button |

### Edit Profile Dialog

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-edit-dialog` | Edit dialog container | div |
| `brotherhood-edit-display-name` | Display name input | input |
| `brotherhood-edit-specialty` | Specialty textarea | textarea |
| `brotherhood-edit-tags` | Tags input | input |
| `brotherhood-edit-domain` | Domain dropdown | select |
| `brotherhood-edit-disclosure-silhouette` | Silhouette radio | input |
| `brotherhood-edit-disclosure-outline` | Outline radio | input |
| `brotherhood-edit-disclosure-open` | Open radio | input |
| `brotherhood-edit-disclosure-transparent` | Transparent radio | input |
| `brotherhood-edit-cancel` | Cancel edit | button |
| `brotherhood-edit-save` | Save changes | button |

### Membrane Preview

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-membrane-preview` | Preview container | div |
| `brotherhood-membrane-name` | Displayed name field | div |
| `brotherhood-membrane-specialty` | Displayed specialty | div |
| `brotherhood-membrane-tags` | Displayed tags | div |
| `brotherhood-membrane-sections` | Prompt section names (Outline+) | div |
| `brotherhood-membrane-section-content` | Prompt content (Open+) | div |
| `brotherhood-membrane-tools` | Tool names list (Outline+) | div |
| `brotherhood-membrane-tool-desc` | Tool descriptions (Open+) | div |
| `brotherhood-membrane-usecases` | Use case titles (Open+) | div |
| `brotherhood-membrane-model` | Model profile (Open+) | div |

### New Encounter Dialog

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-encounter-dialog` | Dialog container | div |
| `brotherhood-encounter-initiator` | Initiator brother selector | select |
| `brotherhood-encounter-responder` | Responder brother selector | select |
| `brotherhood-encounter-type-compare` | Compare type radio | input |
| `brotherhood-encounter-type-consult` | Consult type radio | input |
| `brotherhood-encounter-type-spar` | Spar type radio | input |
| `brotherhood-encounter-type-mentor` | Mentor type radio | input |
| `brotherhood-encounter-topic` | Topic input (optional) | input |
| `brotherhood-encounter-max-rounds` | Max rounds selector | select |
| `brotherhood-encounter-budget` | Budget limit input | input |
| `brotherhood-encounter-cancel` | Cancel dialog | button |
| `brotherhood-encounter-start` | Start encounter button | button |

### Encounters Panel

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-encounters` | Encounters panel container | div |
| `brotherhood-encounters-new-btn` | "New Encounter" button | button |
| `brotherhood-encounters-filter` | Status filter dropdown | select |
| `brotherhood-encounters-list` | Encounters list container | div |
| `brotherhood-encounters-empty` | Empty state | div |
| `brotherhood-encounter-card-${id}` | Encounter summary card | div |
| `brotherhood-encounter-status-${id}` | Status badge on card | span |
| `brotherhood-encounter-expand-${id}` | Expand encounter detail | button |
| `brotherhood-encounter-cancel-${id}` | Cancel active encounter | button |

### Encounter Detail View

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-encounter-detail` | Detail view container | div |
| `brotherhood-encounter-back` | Back to list button | button |
| `brotherhood-encounter-header` | Encounter header (names, type, topic) | div |
| `brotherhood-encounter-cost` | Cost display | span |
| `brotherhood-encounter-progress` | Progress indicator (round N of M) | div |
| `brotherhood-dialogue-timeline` | Timeline container | div |
| `brotherhood-round-${roundNumber}` | Round container | div |
| `brotherhood-round-phase-${roundNumber}` | Round phase label | span |
| `brotherhood-round-focus-${roundNumber}` | Round focus area label | span |
| `brotherhood-bubble-initiator-${roundNumber}` | Initiator message bubble | div |
| `brotherhood-bubble-responder-${roundNumber}` | Responder message bubble | div |
| `brotherhood-eval-summary` | Evaluation summary section | div |
| `brotherhood-eval-initiator` | Initiator evaluation scores | div |
| `brotherhood-eval-responder` | Responder evaluation scores | div |
| `brotherhood-eval-score-${dimension}` | Score by dimension (relevance/novelty/actionability/overall) | span |
| `brotherhood-encounter-proposals` | Proposals section at bottom | div |
| `brotherhood-encounter-proposal-${id}` | Proposal link/card in encounter detail | div |

### Proposals Panel

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-proposals` | Proposals panel container | div |
| `brotherhood-proposals-filter` | Status filter dropdown | select |
| `brotherhood-proposals-list` | Proposals list container | div |
| `brotherhood-proposals-empty` | Empty state | div |
| `brotherhood-proposal-card-${id}` | Proposal summary card | div |
| `brotherhood-proposal-type-${id}` | Proposal type badge | span |
| `brotherhood-proposal-status-${id}` | Proposal status badge | span |
| `brotherhood-proposal-approve-lab-${id}` | "Approve & Lab Test" button | button |
| `brotherhood-proposal-approve-direct-${id}` | "Apply Directly" button | button |
| `brotherhood-proposal-reject-${id}` | "Reject" button | button |
| `brotherhood-proposal-expand-${id}` | Expand to detail view | button |

### Proposal Detail View

| testid | Element | Type |
|--------|---------|------|
| `brotherhood-proposal-detail` | Detail view container | div |
| `brotherhood-proposal-back` | Back to list | button |
| `brotherhood-proposal-title` | Proposal title | h2 |
| `brotherhood-proposal-description` | Description text | div |
| `brotherhood-proposal-rationale` | Rationale text | div |
| `brotherhood-proposal-diff` | Diff view container | div |
| `brotherhood-proposal-diff-before` | Before section of diff | div |
| `brotherhood-proposal-diff-after` | After section of diff | div |
| `brotherhood-proposal-source` | Source brother info | div |
| `brotherhood-proposal-encounter-link` | Link to source encounter | button |
| `brotherhood-proposal-lab-status` | Lab experiment status (if running) | div |
| `brotherhood-proposal-lab-result` | Lab result banner (if complete) | div |
| `brotherhood-proposal-fitness-delta` | Fitness delta value | span |
| `brotherhood-proposal-action-approve-lab` | Approve & Lab action | button |
| `brotherhood-proposal-action-approve-direct` | Apply directly action | button |
| `brotherhood-proposal-action-reject` | Reject action | button |

### Total: **145 testIds** (35 static containers + 40 action elements + 70 dynamic/list items)

---

## User-Centric Test Scenarios

### Scenario 1: Plugin Discovery & Navigation

**Goal:** User finds and navigates the Brotherhood plugin for the first time.

```
S1.1 — Navigate to Brotherhood plugin
  1. navigate("plugins")
  2. snapshot() → assert pageTitle contains "PLUGINS"
  3. click_testid("tab-brotherhood")
  4. wait_for('[data-testid="brotherhood-page"]')
  5. snapshot() → assert no errors

S1.2 — Sub-tab navigation
  1. click_testid("tab-brotherhood-dashboard")
  2. wait_for('[data-testid="brotherhood-dashboard"]')
  3. click_testid("tab-brotherhood-enrollment")
  4. wait_for('[data-testid="brotherhood-enrollment"]')
  5. click_testid("tab-brotherhood-encounters")
  6. wait_for('[data-testid="brotherhood-encounters"]')
  7. click_testid("tab-brotherhood-proposals")
  8. wait_for('[data-testid="brotherhood-proposals"]')

S1.3 — Empty states render correctly
  1. click_testid("tab-brotherhood-dashboard")
  2. wait_for('[data-testid="brotherhood-recent-empty"]')
     → assert text contains "No encounters yet"
  3. wait_for('[data-testid="brotherhood-pending-empty"]')
     → assert text contains "No pending proposals"
  4. click_testid("tab-brotherhood-enrollment")
  5. wait_for('[data-testid="brotherhood-enrolled-empty"]')
     → assert text contains "No brothers enrolled"
```

### Scenario 2: Persona Enrollment

**Goal:** User enrolls their first persona as a brother.

```
S2.1 — Open enrollment dialog
  1. navigate("plugins")
  2. click_testid("tab-brotherhood")
  3. click_testid("tab-brotherhood-enrollment")
  4. click_testid("brotherhood-enroll-btn")
  5. wait_for('[data-testid="brotherhood-enroll-dialog"]')
  6. snapshot() → assert modal visible

S2.2 — Fill enrollment form
  1. fill_field("brotherhood-enroll-persona-select", "{personaId}")
     → persona dropdown populated from available personas
  2. fill_field("brotherhood-enroll-display-name", "Code Reviewer")
  3. fill_field("brotherhood-enroll-specialty", "Reviews code for quality and correctness")
  4. fill_field("brotherhood-enroll-tags", "code-review")
     → tag chip appears
  5. fill_field("brotherhood-enroll-domain", "software-engineering")
  6. click_testid("brotherhood-enroll-disclosure-outline")
     → Outline radio selected

S2.3 — Preview membrane before enrolling
  1. click_testid("brotherhood-enroll-preview-toggle")
  2. wait_for('[data-testid="brotherhood-membrane-preview"]')
  3. query('[data-testid="brotherhood-membrane-name"]')
     → assert text = "Code Reviewer"
  4. query('[data-testid="brotherhood-membrane-sections"]')
     → assert prompt section names visible (Outline level)
  5. query('[data-testid="brotherhood-membrane-tools"]')
     → assert tool names visible
  6. query('[data-testid="brotherhood-membrane-section-content"]')
     → assert NOT visible (Outline level hides content)

S2.4 — Submit enrollment
  1. click_testid("brotherhood-enroll-submit")
  2. wait_toast("enrolled as brother", 5000)
  3. wait_for('[data-testid^="brotherhood-brother-card-"]')
     → card appears in enrolled list

S2.5 — Enroll second persona
  1. click_testid("brotherhood-enroll-btn")
  2. wait_for('[data-testid="brotherhood-enroll-dialog"]')
  3. fill_field("brotherhood-enroll-persona-select", "{secondPersonaId}")
  4. fill_field("brotherhood-enroll-display-name", "Security Auditor")
  5. fill_field("brotherhood-enroll-specialty", "Identifies security vulnerabilities")
  6. fill_field("brotherhood-enroll-tags", "security")
  7. click_testid("brotherhood-enroll-disclosure-open")
  8. click_testid("brotherhood-enroll-submit")
  9. wait_toast("enrolled as brother", 5000)

S2.6 — Verify dashboard updates
  1. click_testid("tab-brotherhood-dashboard")
  2. query('[data-testid="brotherhood-stat-enrolled"]')
     → assert text contains "2"
```

### Scenario 3: Disclosure Level Preview Comparison

**Goal:** User compares what each disclosure level reveals to make an informed choice.

```
S3.1 — Silhouette shows minimal data
  1. click_testid("tab-brotherhood-enrollment")
  2. click_testid("brotherhood-enroll-btn")
  3. fill_field("brotherhood-enroll-persona-select", "{personaId}")
  4. click_testid("brotherhood-enroll-disclosure-silhouette")
  5. click_testid("brotherhood-enroll-preview-toggle")
  6. wait_for('[data-testid="brotherhood-membrane-preview"]')
  7. query('[data-testid="brotherhood-membrane-tags"]')
     → assert visible (tags always shown)
  8. query('[data-testid="brotherhood-membrane-sections"]')
     → assert NOT present (hidden at Silhouette)
  9. query('[data-testid="brotherhood-membrane-tools"]')
     → assert NOT present (hidden at Silhouette)

S3.2 — Open shows prompt content
  1. click_testid("brotherhood-enroll-disclosure-open")
  2. query('[data-testid="brotherhood-membrane-sections"]')
     → assert visible
  3. query('[data-testid="brotherhood-membrane-section-content"]')
     → assert visible (Open shows content)
  4. query('[data-testid="brotherhood-membrane-tools"]')
     → assert visible
  5. query('[data-testid="brotherhood-membrane-tool-desc"]')
     → assert visible (Open shows descriptions)

S3.3 — Transparent shows design context
  1. click_testid("brotherhood-enroll-disclosure-transparent")
  2. query('[data-testid="brotherhood-membrane-usecases"]')
     → assert visible (Transparent shows use cases)
  3. query('[data-testid="brotherhood-membrane-model"]')
     → assert visible (Transparent shows model)

S3.4 — Cancel preserves nothing
  1. click_testid("brotherhood-enroll-cancel")
  2. query('[data-testid="brotherhood-enroll-dialog"]')
     → assert NOT present (dialog closed)
```

### Scenario 4: Self-Encounter — Full Lifecycle

**Goal:** User runs a complete encounter between two enrolled personas.

```
S4.1 — Start encounter from dashboard
  1. click_testid("tab-brotherhood-dashboard")
  2. click_testid("brotherhood-new-encounter-btn")
  3. wait_for('[data-testid="brotherhood-encounter-dialog"]')

S4.2 — Configure encounter
  1. fill_field("brotherhood-encounter-initiator", "{brother1Id}")
  2. fill_field("brotherhood-encounter-responder", "{brother2Id}")
  3. click_testid("brotherhood-encounter-type-compare")
  4. fill_field("brotherhood-encounter-topic", "Error Handling Best Practices")
  5. fill_field("brotherhood-encounter-max-rounds", "3")
  6. fill_field("brotherhood-encounter-budget", "0.30")

S4.3 — Launch encounter
  1. click_testid("brotherhood-encounter-start")
  2. wait_toast("Encounter started", 5000)
  3. wait_for('[data-testid="brotherhood-encounter-detail"]', 10000)
     → auto-navigates to encounter detail

S4.4 — Monitor round progress
  1. wait_for('[data-testid="brotherhood-encounter-progress"]')
     → shows "Round 1 of 3"
  2. wait_for('[data-testid="brotherhood-round-1"]', 60000)
     → first round completes (up to 60s for LLM)
  3. query('[data-testid="brotherhood-round-phase-1"]')
     → assert text = "Introduction"
  4. query('[data-testid="brotherhood-bubble-initiator-1"]')
     → assert contains text (initiator's introduction)
  5. query('[data-testid="brotherhood-bubble-responder-1"]')
     → assert contains text (responder's introduction)

S4.5 — Wait for encounter completion
  1. wait_for('[data-testid="brotherhood-eval-summary"]', 180000)
     → all rounds + evaluation complete (up to 3 min)
  2. query('[data-testid="brotherhood-encounter-cost"]')
     → assert numeric value < 0.30 (within budget)

S4.6 — Verify evaluation scores
  1. query('[data-testid="brotherhood-eval-initiator"]')
     → assert visible with scores
  2. query('[data-testid="brotherhood-eval-responder"]')
     → assert visible with scores
  3. query('[data-testid="brotherhood-eval-score-relevance"]')
     → assert numeric value 0-100

S4.7 — Verify proposals generated
  1. query('[data-testid="brotherhood-encounter-proposals"]')
     → assert visible
  2. query('[data-testid^="brotherhood-encounter-proposal-"]')
     → assert count >= 1 (at least one proposal generated)
```

### Scenario 5: Proposal Review & Approval to Lab

**Goal:** User reviews a generated proposal and sends it to Lab for testing.

```
S5.1 — Find pending proposal
  1. click_testid("tab-brotherhood-proposals")
  2. wait_for('[data-testid="brotherhood-proposals-list"]')
  3. query('[data-testid^="brotherhood-proposal-card-"]')
     → assert count >= 1
  4. query('[data-testid^="brotherhood-proposal-status-"]')
     → assert first card status = "generated" or "delivered"

S5.2 — View proposal detail
  1. click_testid("brotherhood-proposal-expand-{proposalId}")
  2. wait_for('[data-testid="brotherhood-proposal-detail"]')
  3. query('[data-testid="brotherhood-proposal-title"]')
     → assert non-empty title
  4. query('[data-testid="brotherhood-proposal-description"]')
     → assert non-empty description
  5. query('[data-testid="brotherhood-proposal-rationale"]')
     → assert non-empty rationale

S5.3 — Verify diff display
  1. query('[data-testid="brotherhood-proposal-diff"]')
     → assert visible
  2. query('[data-testid="brotherhood-proposal-diff-after"]')
     → assert contains proposed change text
  3. query('[data-testid="brotherhood-proposal-source"]')
     → assert shows source brother name

S5.4 — Approve to Lab
  1. click_testid("brotherhood-proposal-action-approve-lab")
  2. wait_toast("Lab experiment started", 10000)
  3. query('[data-testid="brotherhood-proposal-status-{proposalId}"]')
     → assert status = "in_experiment"
  4. query('[data-testid="brotherhood-proposal-lab-status"]')
     → assert shows lab run info

S5.5 — Navigate to source encounter
  1. click_testid("brotherhood-proposal-encounter-link")
  2. wait_for('[data-testid="brotherhood-encounter-detail"]')
     → navigates to encounter that generated this proposal
  3. click_testid("brotherhood-encounter-back")
     → returns to encounter list
```

### Scenario 6: Proposal Direct Apply (Skip Lab)

**Goal:** User applies a proposal directly without Lab testing.

```
S6.1 — Apply proposal directly
  1. click_testid("tab-brotherhood-proposals")
  2. click_testid("brotherhood-proposal-expand-{proposalId}")
  3. wait_for('[data-testid="brotherhood-proposal-detail"]')
  4. click_testid("brotherhood-proposal-action-approve-direct")
  5. wait_toast("applied directly", 10000)
  6. query('[data-testid="brotherhood-proposal-status-{proposalId}"]')
     → assert status = "adopted"
```

### Scenario 7: Proposal Rejection

**Goal:** User reviews and rejects a proposal.

```
S7.1 — Reject from list
  1. click_testid("tab-brotherhood-proposals")
  2. click_testid("brotherhood-proposal-reject-{proposalId}")
  3. wait_toast("Proposal rejected", 5000)
  4. query('[data-testid="brotherhood-proposal-status-{proposalId}"]')
     → assert status = "rejected"

S7.2 — Reject from detail
  1. click_testid("brotherhood-proposal-expand-{otherProposalId}")
  2. wait_for('[data-testid="brotherhood-proposal-detail"]')
  3. click_testid("brotherhood-proposal-action-reject")
  4. wait_toast("Proposal rejected", 5000)
  5. click_testid("brotherhood-proposal-back")
```

### Scenario 8: Edit Brother Profile

**Goal:** User modifies an enrolled brother's profile.

```
S8.1 — Open edit dialog
  1. click_testid("tab-brotherhood-enrollment")
  2. click_testid("brotherhood-brother-edit-{brotherId}")
  3. wait_for('[data-testid="brotherhood-edit-dialog"]')

S8.2 — Modify fields
  1. fill_field("brotherhood-edit-display-name", "Senior Code Reviewer")
  2. fill_field("brotherhood-edit-specialty", "Expert code review for Python and Rust")
  3. click_testid("brotherhood-edit-disclosure-transparent")

S8.3 — Save and verify
  1. click_testid("brotherhood-edit-save")
  2. wait_toast("Profile updated", 5000)
  3. query('[data-testid="brotherhood-brother-card-{brotherId}"]')
     → assert text contains "Senior Code Reviewer"
     → assert text contains "Transparent"
```

### Scenario 9: Unenroll a Brother

**Goal:** User removes a persona from Brotherhood.

```
S9.1 — Unenroll from card
  1. click_testid("tab-brotherhood-enrollment")
  2. query('[data-testid^="brotherhood-brother-card-"]')
     → note count before
  3. click_testid("brotherhood-brother-unenroll-{brotherId}")
  4. wait_toast("unenrolled", 5000)
  5. query('[data-testid^="brotherhood-brother-card-"]')
     → assert count = previous - 1

S9.2 — Verify dashboard stat decreases
  1. click_testid("tab-brotherhood-dashboard")
  2. query('[data-testid="brotherhood-stat-enrolled"]')
     → assert reflects new count
```

### Scenario 10: Cancel Active Encounter

**Goal:** User cancels an encounter that is in progress.

```
S10.1 — Cancel from encounter card
  1. click_testid("tab-brotherhood-encounters")
  2. query('[data-testid^="brotherhood-encounter-status-"]')
     → find one with status "in_dialogue"
  3. click_testid("brotherhood-encounter-cancel-{encounterId}")
  4. wait_toast("Encounter cancelled", 5000)
  5. query('[data-testid="brotherhood-encounter-status-{encounterId}"]')
     → assert status = "abandoned"

S10.2 — Verify no proposals from cancelled encounter
  1. click_testid("tab-brotherhood-proposals")
  2. query('[data-testid^="brotherhood-proposal-card-"]')
     → none should reference the cancelled encounter
```

### Scenario 11: Budget Enforcement

**Goal:** Verify encounter stops gracefully when budget is exceeded.

```
S11.1 — Create low-budget encounter
  1. click_testid("brotherhood-new-encounter-btn")
  2. fill_field("brotherhood-encounter-initiator", "{brother1Id}")
  3. fill_field("brotherhood-encounter-responder", "{brother2Id}")
  4. click_testid("brotherhood-encounter-type-compare")
  5. fill_field("brotherhood-encounter-max-rounds", "10")
  6. fill_field("brotherhood-encounter-budget", "0.10")
     → intentionally low budget for 10 rounds
  7. click_testid("brotherhood-encounter-start")

S11.2 — Verify early conclusion
  1. wait_for('[data-testid="brotherhood-eval-summary"]', 180000)
  2. query('[data-testid="brotherhood-encounter-cost"]')
     → assert value <= 0.10 (budget respected)
  3. query('[data-testid^="brotherhood-round-"]')
     → assert count < 10 (encounter stopped early)
     → assert last round phase = "synthesis" (graceful conclusion)
```

### Scenario 12: Encounter Filtering & History

**Goal:** User filters encounters by status and persona.

```
S12.1 — Filter by status
  1. click_testid("tab-brotherhood-encounters")
  2. fill_field("brotherhood-encounters-filter", "completed")
  3. query('[data-testid^="brotherhood-encounter-status-"]')
     → assert all have status = "completed"

S12.2 — Show all
  1. fill_field("brotherhood-encounters-filter", "all")
  2. query('[data-testid^="brotherhood-encounter-card-"]')
     → assert count includes all statuses
```

### Scenario 13: Proposal Status Lifecycle

**Goal:** Verify the full proposal status chain from generated through adopted.

```
S13.1 — Track status progression
  1. click_testid("tab-brotherhood-proposals")

  Step A: New proposal appears as "generated"
  2. query('[data-testid="brotherhood-proposal-status-{id}"]')
     → assert "generated"

  Step B: After delivery → "delivered"
  (automatic — delivered via Messages + ManualReview)

  Step C: Approve to Lab → "in_experiment"
  3. click_testid("brotherhood-proposal-approve-lab-{id}")
  4. query('[data-testid="brotherhood-proposal-status-{id}"]')
     → assert "in_experiment"

  Step D: Lab completes with positive delta → "adopted"
  (wait for Lab background task)
  5. wait_for('[data-testid="brotherhood-proposal-lab-result"]', 120000)
  6. query('[data-testid="brotherhood-proposal-status-{id}"]')
     → assert "adopted" or "rejected"
  7. query('[data-testid="brotherhood-proposal-fitness-delta"]')
     → assert numeric value present
```

### Scenario 14: Cross-Module Integration — Messages

**Goal:** Verify proposals appear in the existing Message Center.

```
S14.1 — Check messages after encounter
  1. Run Scenario 4 (complete encounter)
  2. navigate("overview")
  3. click_testid("tab-messages")
  4. find_text("Brotherhood:")
     → assert at least one message with "Brotherhood:" prefix in title
  5. find_text("brotherhood_proposal")
     → verify content_type in message metadata

S14.2 — Message threading
  1. All proposals from same encounter share thread_id
     → verify via API: list messages, check thread_id grouping
```

### Scenario 15: Cross-Module Integration — Human Review

**Goal:** Verify proposals appear in the existing Manual Review queue.

```
S15.1 — Check reviews after encounter
  1. Run Scenario 4 (complete encounter)
  2. navigate("overview")
  3. click_testid("tab-manual-review")
  4. find_text("Brotherhood Proposal:")
     → assert at least one review with Brotherhood prefix
  5. query('[data-testid^="review-row-"]')
     → find the Brotherhood review row

S15.2 — Approve from Review queue (alternative path)
  1. Click the Brotherhood review row in Manual Review
  2. The existing ReviewFocusFlow should render proposal context
  3. Approve via existing review approve action
     → triggers the same Lab promotion as Brotherhood approve
```

### Scenario 16: Cross-Module Integration — Lab

**Goal:** Verify the Lab experiment is correctly created from a proposal.

```
S16.1 — Verify Lab run after approval
  1. Complete Scenario 5 (approve proposal to Lab)
  2. Navigate to the target persona
  3. select_agent("{targetPersonaName}")
  4. open_editor_tab("lab")
  5. click_testid("lab-mode-ab") (or "lab-mode-matrix")
  6. query('[data-testid^="test-run-"]')
     → assert a lab run exists with change_summary referencing "Brotherhood"

S16.2 — Lab results feed back
  1. Wait for lab run completion
  2. Navigate back to Brotherhood proposals
  3. click_testid("tab-brotherhood-proposals")
  4. query('[data-testid="brotherhood-proposal-fitness-delta"]')
     → assert shows numeric delta from Lab results
```

### Scenario 17: Dashboard Stats Accuracy

**Goal:** Verify dashboard stats reflect actual data.

```
S17.1 — Stats match reality
  1. click_testid("tab-brotherhood-dashboard")
  2. enrolled = query('[data-testid="brotherhood-stat-enrolled"]').text
  3. click_testid("tab-brotherhood-enrollment")
  4. cards = query('[data-testid^="brotherhood-brother-card-"]').count
  5. assert enrolled == cards

  6. click_testid("tab-brotherhood-dashboard")
  7. encounters = query('[data-testid="brotherhood-stat-encounters"]').text
  8. click_testid("tab-brotherhood-encounters")
  9. fill_field("brotherhood-encounters-filter", "completed")
  10. completed = query('[data-testid^="brotherhood-encounter-card-"]').count
  11. assert encounters == completed
```

### Scenario 18: Error Handling — Same Brother Guard

**Goal:** Verify user cannot create an encounter with the same persona on both sides.

```
S18.1 — Same persona both sides
  1. click_testid("brotherhood-new-encounter-btn")
  2. fill_field("brotherhood-encounter-initiator", "{brother1Id}")
  3. fill_field("brotherhood-encounter-responder", "{brother1Id}")
  4. click_testid("brotherhood-encounter-start")
  5. wait_toast("Cannot encounter yourself", 5000)
     → OR: "brotherhood-encounter-start" button should be disabled
     → OR: responder dropdown should exclude selected initiator
```

### Scenario 19: Error Handling — Not Enough Brothers

**Goal:** Verify graceful handling when user tries encounter with < 2 enrolled brothers.

```
S19.1 — No brothers enrolled
  1. click_testid("tab-brotherhood-encounters")
  2. click_testid("brotherhood-encounters-new-btn")
     → if 0 brothers: dialog shows message "Enroll at least 2 personas first"
     → button may be disabled with tooltip

S19.2 — Only one brother
  1. Enroll 1 persona only
  2. click_testid("brotherhood-encounters-new-btn")
     → dialog shows: "Need at least 2 enrolled brothers"
     → OR start button disabled
```

### Scenario 20: End-to-End Happy Path (Full Pipeline)

**Goal:** Complete pipeline from enrollment through measurable persona improvement.

```
S20 — Full pipeline
  1. Navigate to Brotherhood
  2. Enroll Persona A as "Code Reviewer" (Outline disclosure)
  3. Enroll Persona B as "Security Auditor" (Open disclosure)
  4. Create Compare encounter, topic: "Code Review Best Practices", 3 rounds, $0.40
  5. Start encounter → wait for completion (~2 min)
  6. Verify evaluation scores appear for both sides
  7. Verify at least 1 proposal generated
  8. Navigate to Proposals tab
  9. Expand first proposal → verify diff view
  10. Click "Approve & Lab Test"
  11. Navigate to target persona → Lab tab → verify A/B run exists
  12. Wait for Lab completion
  13. Navigate back to Brotherhood Proposals
  14. Verify proposal shows fitness delta
  15. Verify dashboard fitness gain stat updated
  16. Navigate to Overview → Messages → verify Brotherhood message exists
  17. Navigate to Overview → Manual Review → verify Brotherhood review exists
```

---

## Smoke Test Script Structure

For automated CI integration, these scenarios can be grouped into tiers:

| Tier | Scenarios | Runtime | What it validates |
|------|-----------|---------|-------------------|
| **T0: Navigation** | S1 | ~5s | Plugin loads, tabs work, empty states render |
| **T1: Enrollment** | S2, S3, S8, S9 | ~15s | CRUD lifecycle for profiles, membrane preview |
| **T2: Encounter** | S4, S10, S11, S12 | ~3min | Encounter creation, execution, budget, filtering |
| **T3: Proposals** | S5, S6, S7, S13 | ~30s | Proposal review actions, status lifecycle |
| **T4: Integration** | S14, S15, S16 | ~2min | Messages, Reviews, Lab cross-module |
| **T5: Validation** | S17, S18, S19 | ~10s | Stats accuracy, error handling, guards |
| **T6: E2E** | S20 | ~5min | Complete pipeline start to finish |

**Total: 20 scenarios, ~145 testIds, ~11 min full run**

---

*This document is the testing contract for Brotherhood B1. All components must include these testIds before implementation is considered complete.*
