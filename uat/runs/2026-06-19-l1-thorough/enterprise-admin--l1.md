# Karen Osei — Enterprise Admin — L1 report

**Run:** 2026-06-19-l1-thorough · **Level:** L1 (theoretical, code-grounded) · **Character:** enterprise-admin (buyer, tier=builder)
**Method:** surface model built from source; no live app. Each finding carries file:line + a code_check classification per rubric.
**Core lens:** blast radius / audit / access control / data residency. The binding question is not "is the claim true in code?" but "can I demonstrate it to a security reviewer from inside the product?" A true-but-invisible guarantee is a finding.

---

## Per-journey verdicts

| Journey | Verdict |
|---|---|
| wire-credential-connector | **L1-conditional** |
| trust-and-governance | **L1-conditional** |
| synthesize-team | **L1-conditional** |
| track-goal-kpi | **L1-conditional** |

No journey is an outright structural fail — the governance machinery genuinely exists and is mostly grounded. But every one carries a "control I can't fully demonstrate / can't defend as enforced" gap that keeps it out of L1-pass. That pattern *is* Karen's verdict: this is a credible local-first engine wrapped in surfaces that under-expose their own guarantees.

---

### Journey 1 — wire-credential-connector → **L1-conditional**

**Rationale.** The credential path is structurally sound and the at-rest crypto is senior-grade: AES-256-GCM with per-record random nonce (`crypto.rs:1263`), master key in OS keychain (Windows Credential Manager / macOS Keychain) with a DPAPI-wrapped local fallback (`crypto.rs:528`, `913`), `mlock`/`VirtualLock` to keep the key off swap (`crypto.rs:319`), zeroize-on-drop secrets (`SecureString`, `crypto.rs:199`), and a **fail-closed** posture — no keychain, no fallback unless `PERSONAS_ALLOW_FALLBACK_KEY=1` (`crypto.rs:491`), and the weaker legacy RSA-only IPC path is **rejected by default** (`crypto.rs:139`). This is the strongest part of the product for Karen and she would champion it. The reason it is *conditional*, not *pass*: at the moment she enters a secret the product tells her almost nothing about all of that. The entry-moment trust signal is one emerald 70%-opacity line — "Encrypted with OS Keychain" / "Encrypted at rest" — gated on the form containing a `password`-type field (`FormActions.tsx:34-43`), with no tooltip, no AES-256-GCM detail, no locality statement. The reviewer-grade explanation strings exist (`vault.vault_badge.aes_detail`, `keychain_detail`) but render nowhere (see finding T1). Definition-of-done ("I'm confident it's stored locally/encrypted, not shipped to a cloud") is met by the consent modal at first run, but not at the recurring entry moment.

Reachability: credentials surface is reachable at every tier (Keys sidebar item is not tier-gated). Connector readiness / wrong-field errors route through the validation + healthcheck path (`FormActions.tsx:71-76` surfaces a save-disabled reason; `healthcheck_required` string exists), so a wrong field gives a visible block, not a silent failure — DoD's second clause is satisfied structurally.

---

### Journey 2 — trust-and-governance → **L1-conditional**

**Rationale.** This is Karen's home journey and the verdict is the most nuanced. What she can defend: (a) a **first-use consent modal** (`FirstUseConsentModal.tsx`, mounted in `App.tsx:304`, gated behind a required acknowledgment checkbox) that explicitly discloses Storage/AES-256-GCM, AI-provider HTTPS egress, clipboard/file/cron/webhook monitoring, **P2P networking**, credential foraging, process execution, and telemetry — with telemetry as opt-**in** (`FirstUseConsentModal.tsx:267-278`). (b) **P2P exposure is explicit and default-off**: `auto_connect: false` (`p2p/types.rs` Default impl), the whole subsystem is compile-gated behind the `p2p` cargo feature (`lib.rs:931`) so the shipping lite build has no P2P at all, and exposure is per-resource opt-in via `ExposureManager.tsx` + `commands/network/exposure.rs`. (c) The management API binds **loopback-only** (`127.0.0.1:9420`) behind an API-key + CORS layer (per `engine/management_api.rs`). (d) A real **execution audit trail** + **credential audit log** (decrypt/create/update/delete/healthcheck, attributed "by <persona>", `AuditLogTable.tsx`, table `vault_audit_log`) + a cross-source **AuditIncident** inbox.

What blocks pass: the governance *posture* the code holds is not fully *legible in-product to an admin*. `vault_status` computes `plaintext` count and `legacy_ipc_decrypt_calls` (`crud.rs:362-375`) — the two numbers a reviewer most wants ("any unencrypted creds? anyone on the weak IPC path?") — but **no UI renders them** (finding T2). The Admin tab is **dev-only** (`devOnly:true`, hidden in release builds) and only resets consent (finding G1). "Access control" is **build-tier packaging, not user/role RBAC** (finding A1). She can build a partial reviewer story, but several of her sharpest questions are answerable only by reading Rust.

---

### Journey 3 — synthesize-team → **L1-conditional**

**Rationale.** A user can synthesize a team from passed templates (`TeamSynthesisPanel.tsx` → `synthesize_team_from_templates`, `commands/design/team_synthesis.rs:166`), and the canvas/roster makes **member roles legible** (presetRole label, tier chip, capability counts, presence pulse — `TeamStudioSplitVariant.tsx:251-384`). Handoff is real (chain triggers + event listeners wired per edge, `engine/team_handoff.rs:63,127-170`). Karen's DoD second clause — "I trust it won't silently stall" — is the conditional: there *is* a disabled-member guard that drops a targeted handoff with a persisted breadcrumb and a frontend emit ("cascade stalled here", `engine/background.rs:997-1019,1225-1231`), which is good engineering. But the **roster shows presence (working/waiting), not enabled/disabled health** — there is no "this member is disabled, the cascade will stall here" badge and no pre-flight check (finding S1). The stall is discoverable post-hoc in logs, not prevented or surfaced at design time. For a 500-person org this is an operability risk, not a blocker.

Reachability: Teams sidebar is `minTier: TEAM` (`sidebarData.ts:38`), so gated above Starter in packaging — but the backend `create_team`/`synthesize_team` commands carry **no tier check** (`commands/teams/teams.rs:36-42`), only `require_auth` (finding A1 / A2).

---

### Journey 4 — track-goal-kpi → **L1-conditional**

**Rationale.** Two layers exist. **Goals** (`GoalEditorModal.tsx`, `GoalsPage.tsx`) let a user author a goal, but goal progress is a **hybrid manual %/checklist** (`dev_tools_resolve_goal_progress` → `compute_suggested_progress`: to-dos done, sub-goals done, linked team-assignment steps done) — **not** tied to execution success/failure. A goal can read 100% while every run fails (finding K1). **KPIs** are the real outcome layer: `DevKpi` with `measure_kind` codebase/connector/manual/derived and `DevKpiMeasurement` recording values with source attribution (`db/models/dev_tools.rs:222-309`); `GoalKpiLink.tsx:79` is even honest about it ("A goal finishing is not success; the next measurement decides"). So the journey's DoD ("distinguishes ran-a-lot from moved-the-number") is achievable — but only via the KPI layer, which is a separate setup, and Goals on their own read as a **dashboard placebo**. Observability is the strong half: `PersonaExecution` is an immutable per-run record (status/duration/tokens/cost/director_score, `db/models/execution.rs:11-84`), surfaced in `ExecutionList.tsx` and rolled into the `get_sla_dashboard` view (`SLADashboard.tsx`) computed from real executions. SLA caveat: it's **read-only observability** — only `get_sla_dashboard` is exposed; there is **no admin-settable SLA target/threshold CRUD** (no `sla_configs` write command), so "SLA" here is a measured number, not an enforced governance commitment (finding K2).

Reachability: goals/KPI live under the dev-tools/teams surfaces; no hard tier or RBAC gate found beyond sidebar packaging.

---

## Findings

### [major][trust] quality-gap — Reviewer-grade trust copy exists in 14 languages but renders nowhere ("dead i18n")
- **expected:** At the credential-entry / vault moment, the product should be able to *show* the reviewer the AES-256-GCM + OS-keychain + locality story (Karen criterion 1, 5).
- **got:** A full `vault.vault_badge` block (`aes_title`, `aes_detail`, `keychain_title`, `keychain_detail`, `fallback_key_title`, `fallback_key_detail`, `vault_secure`, `vault_needs_attention`, `encrypted_fallback`) is authored and translated into all 14 locales — but no `.tsx` component consumes any of these keys. The entry-moment signal is reduced to a single one-line label.
- **evidence:** strings at `src/i18n/locales/en.json` (section `vault.vault_badge`, ~line 4150-4170); consumer search across `src/**/*.tsx` for `vault_badge|aes_title|aes_detail|keychain_detail|fallback_key_detail` returns **zero** matches. Only live trust label: `src/features/vault/sub_credentials/components/forms/FormActions.tsx:34-43`.
- **code_check:** confirmed-absent (rendering); strings present-but-unused.
- **reachable:** yes (vault is all-tier reachable).
- **l2_priority:** medium — confirm live that no other route renders these (e.g. a security/info panel). If truly dead, this is a cheap, high-leverage fix: wire `vault_badge` into the credential form/header.

### [major][missing] missing-feature — `vault_status` plaintext + legacy-IPC counters are computed but never surfaced to an admin
- **expected:** An admin must be able to answer "are any credentials still stored in plaintext?" and "is anything still using the weaker legacy IPC path?" from inside the product (criterion 1, 4, 5).
- **got:** `vault_status` returns `key_source`, `total`, `encrypted`, `plaintext`, `legacy_ipc_decrypt_calls` — the exact governance numbers — but the only frontend consumer (`CredentialEditForm`) reads `key_source` solely to pick the one-line FormActions label. `plaintext`, `legacy_ipc_decrypt_calls`, and the encrypted/total ratio are dropped on the floor. Not surfaced in CredentialManager and not in AdminSettings.
- **evidence:** backend `src-tauri/src/commands/credentials/crud.rs:362-375`; sole consumer `src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:64-69` → `FormActions.tsx:38`; grep of `CredentialManager.tsx` and `AdminSettings.tsx` for `vault_status|plaintext|legacy_ipc|key_source` returns zero.
- **code_check:** confirmed-absent (UI surface).
- **reachable:** backend reachable (public read-only command); UI surface absent.
- **l2_priority:** high — this is the single most defensible vault metric for a security reviewer and it's invisible.

### [major][completion] trust — "Access control" is build-time tier packaging, not user/role RBAC
- **expected:** Team/access control should "actually gate as claimed" and not be all-or-nothing (criterion 3; pet peeve: all-or-nothing access). Karen needs per-team / per-role control she can defend.
- **got:** "Tier" (Starter/Team/Builder) is a **build-time constant** (`BUILD_MAX_TIER = VITE_APP_TIER ?? builder`) consumed by `useTier().isVisible()` for sidebar visibility + tree-shaking. There is **no runtime per-user access model, no roles, no per-team permissions** — this is a single-user desktop app. Tiers gate which features compile into a bundle, not who may do what.
- **evidence:** `src/hooks/utility/interaction/useTier.ts:41-53`; `src/lib/constants/uiModes.ts:40-46`; sidebar gating `src/features/shared/chrome/sidebar/sidebarData.ts:38` (`minTier: TIERS.TEAM`).
- **code_check:** by-design (single-user desktop) — but a *gap vs Karen's mental model* of multi-tenant RBAC.
- **reachable:** yes.
- **l2_priority:** low (architectural; unlikely to change). Record as scoping truth: "governance = process/data controls, not user RBAC."

### [major][completion] broken-flow — Backend team commands enforce no tier; frontend gate is cosmetic
- **expected:** If Team features are gated to Team/Builder, the gate should hold at the command boundary, not only by hiding a sidebar item (criterion 3).
- **got:** `create_team` and `synthesize_team_from_templates` check only `require_auth_sync` — no tier validation. The sidebar visibility gate (`minTier: TEAM`) is the only barrier, and it is cosmetic for any caller that reaches the command (or in a Builder-default build, no barrier at all).
- **evidence:** `src-tauri/src/commands/teams/teams.rs:36-42`; `src-tauri/src/commands/design/team_synthesis.rs:166-171`; gate `sidebarData.ts:38`.
- **code_check:** confirmed-absent (backend enforcement).
- **reachable:** yes (Builder is the default build tier).
- **l2_priority:** medium — for a single-user desktop the impact is low, but if tiers ever map to licensing/entitlement this is a bypass.

### [major][missing] quality-gap — Goals report progress decoupled from execution reality (outcome placebo)
- **expected:** Goal progress should reflect whether agents actually moved the number, distinguishing activity from outcome (Journey 4 DoD).
- **got:** Goal progress is computed from manual % + checklist/sub-goal/step completion, with no link to `PersonaExecution` success/failure. A goal can show "done" while runs fail. The honest path (KPIs, grounded in `DevKpiMeasurement`) is a separate, optional surface.
- **evidence:** progress computation `src-tauri/src/commands/infrastructure/dev_tools.rs` (`dev_tools_resolve_goal_progress` → `compute_suggested_progress`); KPI layer `src-tauri/src/db/models/dev_tools.rs:222-309`; honest-framing copy `src/features/teams/sub_goals/GoalKpiLink.tsx:79`.
- **code_check:** present-but-missed (KPI grounding exists; goals don't use it).
- **reachable:** yes.
- **l2_priority:** medium — L2 should confirm whether a real KPI measurement appears from run data, or reads as a placebo too.

### [minor][missing] missing-feature — SLA is read-only observability, not an admin-settable/enforced target
- **expected:** A security/ops reviewer expects to *set* an SLA target and have violations flagged against it (criterion 4).
- **got:** Only `get_sla_dashboard` is exposed; success-rate/MTBF/latency are computed from executions and displayed read-only. No `sla_configs` write command (set/create/update target) was found, despite a `sla_configs` table existing in the schema map.
- **evidence:** `src-tauri/src/commands/communication/sla.rs:13-21` (only `get_sla_dashboard`); grep for `set_sla_target|create_sla_config|update_sla_config` across `src-tauri/src` returns zero; UI `src/features/overview/sub_sla/components/SLADashboard.tsx`.
- **code_check:** confirmed-absent (configurability).
- **reachable:** dashboard reachable; config surface absent.
- **l2_priority:** low-medium — confirm whether `AlertRulesPanel` (referenced in ObservabilityDashboard) provides threshold config that substitutes for SLA targets.

### [minor][missing] quality-gap — No design-time / pre-flight liveness check for disabled team members
- **expected:** Before running, the canvas should warn "member X is disabled — handoff will stall at step Y" (Journey 3 DoD: "won't silently stall").
- **got:** Disabled-member handoffs are dropped with a persisted breadcrumb + frontend emit at *runtime* (`background.rs:997-1019,1225-1231`), but the roster shows only presence (working/waiting), not enabled/disabled, and there is no pre-flight validation. There is also no DLQ/retry for deliberately-disabled members (intentional, but undiscoverable at design time).
- **evidence:** guard `src-tauri/src/engine/background.rs:997-1019`; stall note `:1225-1231`; roster presence-only `src/features/teams/sub_teamWorkspace/TeamStudioSplitVariant.tsx:335-342`.
- **code_check:** present-but-missed (runtime guard exists; design-time surface doesn't).
- **reachable:** yes.
- **l2_priority:** medium — L2 should run a team with a disabled member and observe whether the canvas communicates the stall or hides it.

### [minor][trust] confusion — Entry-moment trust label is conditional on a `password`-typed field and visually de-emphasized
- **expected:** Every credential-entry surface signals locality/encryption clearly (criterion 1, 5).
- **got:** The "Encrypted with OS Keychain / at rest" label only renders when the form has a `password`-type field, at `text-emerald-400/70` with no detail. OAuth, bearer-token, MCP-URL, or DB credentials whose sensitive fields aren't typed `password` may show no trust signal at all.
- **evidence:** `src/features/vault/sub_credentials/components/forms/FormActions.tsx:34` (`fields.some((f) => f.type === 'password')`).
- **code_check:** present-broken (incomplete coverage).
- **reachable:** yes.
- **l2_priority:** medium — verify the trust label across all credential types (API key, OAuth, DB, MCP) at L2.

---

## What passed (strengths — do not regress)

- **At-rest credential crypto is senior-grade and fail-closed.** AES-256-GCM + per-record nonce (`crypto.rs:1263`), OS-keychain master key with DPAPI-wrapped local fallback (`crypto.rs:528,913`), `mlock`/`VirtualLock` anti-swap (`crypto.rs:319`), zeroize-on-drop `SecureString`/`EncryptedToken` (`crypto.rs:199,265`), keychain-required-by-default (`crypto.rs:491`), legacy weak-IPC path **rejected by default** (`crypto.rs:139`), legacy plaintext key-file import **refused unless explicit migration flag** (`crypto.rs:687`). This is the load-bearing trust claim and it is real.
- **First-use consent modal is a genuine reviewer artifact.** Explicit, checkbox-gated disclosure of storage, AI egress, monitoring, P2P, foraging, process exec, and telemetry (opt-in). `FirstUseConsentModal.tsx`, mounted `App.tsx:304`, versioned re-consent on disclosure changes.
- **Network/P2P exposure is explicit and default-off.** `auto_connect:false` (`p2p/types.rs` Default), whole subsystem compile-gated (`lib.rs:931`), per-resource opt-in exposure UI (`ExposureManager.tsx` + `commands/network/exposure.rs`), management API loopback-only behind API key + CORS. No implicit exposure found.
- **Execution audit + credential audit + incident triage are grounded in real data.** Immutable `PersonaExecution` per run (`db/models/execution.rs:11-84`), persona-attributed credential audit log (`AuditLogTable.tsx`, `vault_audit_log`), SLA dashboard computed from executions (`SLADashboard.tsx`), cross-source `AuditIncident` inbox.
- **Team roles + handoff are real and legible.** Roster shows roles/tier/capabilities (`TeamStudioSplitVariant.tsx:251-384`); handoff wired as chain triggers + listeners per edge (`team_handoff.rs:63,127-170`); disabled-member drop leaves a forensic breadcrumb rather than failing silently.
- **KPI layer is an honest outcome model** with source-attributed measurements (`db/models/dev_tools.rs:222-309`) and copy that explicitly resists the "goal done = success" fallacy (`GoalKpiLink.tsx:79`).

---

## Character voice

I will say plainly what I told the vendor on the last three tools I rejected: an encryption guarantee I cannot put on a screen for my security committee is, for procurement purposes, a guarantee that does not exist. And here the frustrating part is that the engineering *is* there. The crypto is exactly what I would specify — AES-256-GCM, OS-keychain-bound master key, fail-closed when the keychain is absent, the weak legacy path refused by default. I can read that in `crypto.rs` and I believe it. But my reviewer does not read Rust, and the product hands him one pale-green line that only appears when a field happens to be typed "password." Meanwhile you have already written the full, correct explanation — AES detail, keychain detail, fallback detail — in fourteen languages, and then wired it to nothing. Render it. At the moment a secret is entered, and in a standing vault-status panel.

Second: show me my own posture. `vault_status` already knows how many credentials are plaintext and whether anyone has touched the legacy IPC path. Those are the two numbers I open every audit with, and your product computes them and then throws them away before they reach a screen. Put them in front of an admin. The Admin tab being dev-only and limited to resetting a consent flag is not an admin surface — it is a debug toggle.

Third, on access control: be honest with buyers that this is a single-user desktop with build-tier *packaging*, not per-user RBAC, and that the team-creation commands enforce no tier at the boundary. I can live with that for a desktop deployment — but I will not let a salesperson imply role-based governance that the command layer does not enforce.

Net: the foundation would survive my review. The *demonstrability* would not — yet. Close the three visibility gaps (entry-moment trust copy, the vault-status admin panel, and a real disabled-member/liveness indicator on the team canvas) and I would move this from "promising, blocked" to "approve with conditions." Show me the audit trail and the access model — you have most of both; you are just not letting me point at them.
