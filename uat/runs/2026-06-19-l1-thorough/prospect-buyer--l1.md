# Greg Holloway — External Prospect / Buyer — L1 report

**Run:** 2026-06-19-l1-thorough · **Level:** L1 (theoretical, code-grounded) · **Character:** prospect-buyer (buyer segment, tier=starter, en)
**Method:** surface model built from source on the `uat-adopt` worktree disk; no live app. Every finding carries file:line + a `code_check` classification per rubric. Corroborated where noted against the sibling `enterprise-admin--l1.md` run (same date), but all cited paths re-verified on this checkout.
**Core lens (Greg).** Twenty minutes, Zapier incumbent, security + pricing are the *first* two questions. The binding test is not "does the engine work?" — it's "in one short skeptical session can I (1) verify where my data lives, (2) find what it costs, (3) see a credible example my senior would respect *without building one*, and (4) name a concrete reason to switch off Zapier?" A guarantee that's true in Rust but invisible on screen does not count. Hidden pricing is a hard peeve.

---

## Per-journey verdicts

| Journey | Verdict |
|---|---|
| first-run-onboarding | **L1-conditional** |
| wire-credential-connector | **L1-conditional** |
| trust-and-governance | **L1-fail** |

The trust-and-governance journey fails for Greg specifically — not because the governance machinery is absent (it isn't; it's genuinely strong in code) but because his **scored criterion #2 (pricing/tier model findable and understandable in a short session) has no in-product surface at all**, and that is the question he asks *first*. A buyer evaluation that cannot answer "what does it cost?" structurally does not complete, regardless of how good the crypto is. The other two journeys complete but carry adoption-relevant majors.

---

### Journey 1 — first-run-onboarding → **L1-conditional**

**Walk (as Greg).** Cold launch. `App.tsx:304` mounts `FirstUseConsentModal` whenever `!consented` (`App.tsx:150`, keyed on `localStorage __personas_user_consent_accepted` v3). This is the **first thing I see**, and for once it is the right first thing: an explicit, checkbox-gated disclosure that opens with "Personas Desktop is a **local-first** AI agent orchestration tool" and a "Local Data Storage" section stating verbatim "Your passwords are encrypted and all your data stays on your computer… encrypted with **AES-256-GCM**… key held in your OS keyring… **No data is sent to Personas servers** unless you explicitly use the optional cloud deployment feature" (`src/i18n/locales/en.json` `consent.storage_*`, ~line 3760-3775; component `FirstUseConsentModal.tsx`). For a skeptic, leading with the data-locality contract before asking for anything is credibility-positive — it answers my "where does my data go?" question in the first 30 seconds.

Then I land on Home (`HomeWelcome.tsx`). It greets me as "**Commander**" (`HomeWelcome.tsx:38`, an Athena-themed honorific) and shows a quick-nav grid of 7 cards (Overview, Teams, Agents, Events, Connections, Templates, Settings — `NAV_CARDS`, `HomeWelcome.tsx:11-20`). This is where the cognitive-walkthrough wobbles: the hero addresses me in sci-fi cosplay ("Commander") and several grid cards point at sections my Starter tier can't enter (Teams/Events/Plugins are `minTier: TEAM` — `sidebarData.ts:38,40,43`). A 20-minute evaluator does not know what "Commander," "Personas," or "Athena" mean; the welcome surface assumes I've already bought the metaphor. There is no "here's a working example, click to see it run" first-action affordance on the welcome screen — the obvious next move (see something real) isn't the highlighted one.

**Verdict rationale.** Completes — I reach Home with the trust story already delivered, no dead-time wall, locale-correct (i18n end to end). Conditional because the framing ("Commander") and the dead-end nav cards (cards that route to tier-locked sections) cost a skeptic clarity at exactly the moment he's deciding whether this is a serious tool or a toy. Not a blocker; a credibility tax.

---

### Journey 2 — wire-credential-connector → **L1-conditional**

**Walk (as Greg).** Connections (`credentials`) sidebar item is **not tier-gated** (`sidebarData.ts:41`, no `minTier` → defaults `STARTER`), so I can reach it on the trial. I open a credential form. The at-rest story behind it is, per code, senior-grade (AES-256-GCM, OS-keychain master key, fail-closed) — and the enterprise-admin run verified `crypto.rs` in depth. My problem is what I *see* at the moment I'm about to paste a secret: `FormActions.tsx:34-43` renders a single `text-emerald-400/70` line — "Encrypted with OS Keychain" / "Encrypted at rest" — and **only when the form contains a `password`-typed field**. No AES-256-GCM detail, no "stays on your machine" restatement, no tooltip, no locality claim. For an API-key or bearer-token or MCP-URL credential whose secret field isn't typed `password`, I may see **no trust signal at all** at entry. And the buttons next to it are hardcoded English "Cancel" / "Save Credential" / "Saving..." (`FormActions.tsx:51,65`) — not even routed through i18n, which a careful evaluator notices as a polish/quality tell.

Reachability across credential types is fine structurally (API key, OAuth, DB, MCP, desktop all flow through the same type-picker → form path per APP_CONTEXT_MAP), and a wrong/missing field surfaces a visible `saveDisabledReason` block (`FormActions.tsx:71-76`) rather than a silent failure — so the journey's second DoD clause holds.

**Verdict rationale.** Completes — I can add a credential through a path I understand, and the consent modal already told me it stays local. Conditional because the *recurring* entry-moment trust signal is thin, conditional on a field type, and the reviewer-grade copy that would close it **exists and is dead** (Finding T1). Greg's criterion #1 ("locality verifiable in-product") is met *once* at first-run consent but under-served at the moment it matters most for a repeat secret.

---

### Journey 3 — trust-and-governance → **L1-fail**

**Walk (as Greg).** This is my buyer journey and it splits hard into a strong half and a disqualifying half.

**Strong half (trust/locality).** The first-use consent modal is a genuine artifact I'd accept (local-first + AES-256-GCM + "no data to Personas servers" + 40+ services use *my* credentials + SSRF blocklist on the API proxy — `en.json consent.storage_*`, `consent.services_*`). P2P is default-off and compile-gated (per enterprise-admin's `lib.rs:931` / `p2p/types.rs` verification). So my "where do my secrets live / what leaves my machine" question is answerable — *at first run*. Criterion #1: **pass-ish** (legible once; under-surfaced at the standing/vault moment — Finding T1/T2).

**Disqualifying half (pricing/tier — my criterion #2, asked FIRST).** I go looking for "what does this cost / what tier am I on / what do I get if I pay." The APP_CONTEXT_MAP told me Settings → Account has a "Tier selector / pricing." **It does not.** `AccountSettings.tsx` (the actual `account` settings tab — `SettingsPage.tsx:9`) renders exactly four sections: Telemetry, Radio, Updates, and Account (Google sign-in / sign-out) — plus a Cloud Sync card when authenticated (`AccountSettings.tsx:73-272`). **There is no tier selector, no plan, no price, no "upgrade," no feature-comparison anywhere in it.**

Worse, the thing the codebase calls "tier" is **not a pricing tier at all** — it's a UI-complexity mode: `TIERS = starter/team/builder` relabeled to the user as **"Simple" / "Power" / (Full feature set)** (`uiModes.ts:24-68`), default `TEAM` ("Power") on fresh install (`uiModes.ts:59`), toggled (where exposed) as an interface mode, not a billing plan. The only dollar figures in the entire product are **Anthropic API token costs** I pay Anthropic directly — Haiku `~$0.25/1K`, Sonnet `~$3/1K`, Opus `~$15/1K` (`ModelSelector.tsx:67-69`) and per-run cost-spent stats (`StatGridWidget.tsx:9`). A full-text sweep for `billing|subscription(plan)|checkout|stripe|payment|free trial|paid plan|/month` across `src/features/**/*.tsx` returns **zero** real pricing UI (the 500+ "subscription" hits are all *event* subscriptions). So I cannot answer my single most important pre-switch question from inside the product. For a buyer comparing against Zapier's (annoying but *legible*) per-task pricing, "I can't even find the price" is a structural fail of the evaluation, not a minor gap.

**Governance/audit.** The Admin tab is dev-only and absent in a release Starter build (enterprise-admin Finding G1); `vault_status` computes the plaintext/legacy-IPC counters a reviewer wants but renders them nowhere (Finding T2, corroborated). "Access control" is build-time packaging, not RBAC — fine for a desktop, but not the multi-tenant governance a salesperson might imply.

**Verdict rationale.** **L1-fail for Greg.** The DoD's third clause — "I formed a clear switch-from-Zapier-or-not verdict" — cannot be reached responsibly when the cost axis is invisible and the word "tier" means something other than what every SaaS buyer expects it to mean. The trust half is good; the buyer-decision half has no surface.

---

## Findings

### [blocker][missing] missing-feature — No pricing / plan / cost-to-switch surface exists anywhere in-product (Greg's first question is unanswerable)
- **expected:** A buyer must be able to find and understand what the product costs and what each tier includes, in a short session (criterion #2; pet peeve: hidden pricing; time-saved: concrete switching value vs Zapier's per-task model).
- **got:** The `account` settings tab (`AccountSettings.tsx`) has Telemetry / Radio / Updates / Google-account sections only — **no tier selector, no pricing, no plan comparison**. The codebase's "tiers" are UI-complexity modes ("Simple"/"Power"), not paid plans (`uiModes.ts:24-68`, default `TEAM`/`uiModes.ts:59`). The only dollar amounts are Anthropic token costs paid to Anthropic, not a Personas price (`ModelSelector.tsx:67-69`). A `src/features/**/*.tsx` sweep for `billing|checkout|stripe|payment|free trial|paid plan|/month` returns zero pricing UI.
- **evidence:** `src/features/settings/sub_account/components/AccountSettings.tsx:73-272` (full section list, no tier/pricing); `src/features/settings/components/SettingsPage.tsx:9` (this *is* the account tab); `src/lib/constants/uiModes.ts:24-68` (tier = Simple/Power mode); `src/features/agents/sub_model_config/components/ModelSelector.tsx:67-69` (the only $ values = AI token cost).
- **code_check:** confirmed-absent.
- **reachable:** yes (Account tab is all-tier reachable) — the surface is reachable; the content is missing.
- **note:** The APP_CONTEXT_MAP's "Account → Tier selector / pricing" entry is **stale/wrong** — there is no such control in the shipped component. This mis-documentation likely set buyer expectations that the product doesn't meet.
- **l2_priority:** high — confirm live that no pricing lives behind sign-in or an external link; if truly absent, this is the single highest-leverage buyer-conversion gap.

### [major][trust] quality-gap — Reviewer-grade vault trust copy exists in 14 languages but renders in zero `.tsx` ("dead i18n")
- **expected:** At the standing credential/vault moment Greg should be able to *see* the AES-256-GCM + OS-keychain + locality story, not just meet it once at first-run consent (criterion #1).
- **got:** A full `vault.vault_badge` block (`aes_title`, `aes_detail`, `keychain_title`, `keychain_detail`, `fallback_key_*`, `vault_secure`, …) is authored and translated into all 14 locales — but a consumer search for `vault_badge|aes_detail|keychain_detail` across `src/**/*.tsx` returns **zero** (only the generated `enSectionStrings.ts`/`types.ts` and the locale JSON files contain it). The only live entry-moment signal is the one-line `FormActions` label.
- **evidence:** strings present at `src/i18n/locales/en.json` (`vault.vault_badge` block); zero `.tsx` consumer (grep across `src` returned only `src/i18n/generated/*` and `src/i18n/locales/*`); sole live label `src/features/vault/sub_credentials/components/forms/FormActions.tsx:34-43`.
- **code_check:** confirmed-absent (rendering); strings present-but-unused.
- **reachable:** yes (vault all-tier reachable).
- **l2_priority:** medium — cheap, high-leverage fix: wire `vault_badge` into the credential form header.

### [major][trust] confusion — Entry-moment encryption label is conditional on a `password`-typed field and visually de-emphasized; buttons are hardcoded English
- **expected:** Every credential-entry surface clearly signals locality/encryption (criterion #1).
- **got:** The "Encrypted with OS Keychain / at rest" label only renders when `fields.some(f => f.type === 'password')` and is styled `text-emerald-400/70` with no detail. OAuth / bearer-token / MCP-URL / DB credentials whose sensitive field isn't typed `password` may show no trust signal. The same component hardcodes "Cancel" / "Save Credential" / "Saving..." (not i18n'd) — a quality tell for a skeptic.
- **evidence:** `src/features/vault/sub_credentials/components/forms/FormActions.tsx:34` (gate), `:51,65` (hardcoded button strings).
- **code_check:** present-broken (incomplete coverage) + minor i18n regression.
- **reachable:** yes.
- **l2_priority:** medium — verify the trust label across all credential types at L2.

### [major][missing] missing-feature — `vault_status` plaintext + legacy-IPC counters computed but never surfaced (no standing trust panel)
- **expected:** A buyer-grade trust story includes a standing "here's your posture" view, not a one-time modal (criterion #1, #4).
- **got:** `vault_status` returns `plaintext` and `legacy_ipc_decrypt_calls` — the exact numbers a reviewer opens with — but the sole frontend consumer reads only `key_source` to pick the one-line label; the counters are dropped. (Corroborated by enterprise-admin run; backend re-cited below.)
- **evidence:** backend `src-tauri/src/commands/credentials/crud.rs:362-375` (per enterprise-admin verification); sole consumer chain `FormActions.tsx:38`.
- **code_check:** confirmed-absent (UI surface).
- **reachable:** backend reachable; UI surface absent.
- **l2_priority:** medium-high.

### [minor][clarity] confusion — Cold-start welcome uses unexplained in-universe framing and routes to tier-locked sections
- **expected:** A first-minute evaluator should know what the app is for and have an obvious "see it work" next move (first-run DoD: "knew what the app was for within the first minute," "never felt lost").
- **got:** Hero addresses the user as "Commander" (`HomeWelcome.tsx:38`) with no explanation; the quick-nav grid surfaces Teams/Events/Plugins cards (`HomeWelcome.tsx:13,15,18`) that are `minTier: TEAM` (`sidebarData.ts:38,40,43`) and dead-end for a Starter trial; no "run a working example" first-action is highlighted on the welcome screen.
- **evidence:** `src/features/home/sub_welcome/HomeWelcome.tsx:11-20,38`; tier gates `src/features/shared/chrome/sidebar/sidebarData.ts:38,40,43`.
- **code_check:** present-broken (UX/expectation mismatch for the buyer segment).
- **reachable:** yes.
- **l2_priority:** low-medium — observe where a first-timer actually clicks first.

---

## What passed (strengths — do not regress)

- **Credible example WITHOUT building — strong pass.** The Templates gallery **auto-seeds 13 published persona templates into the DB on first mount** (`useDesignReviews.ts:89-122` → `getSeedReviews()` → `batchImportDesignReviews`; catalog source `templateCatalog.ts`, content `scripts/templates/content/*.json` = 13 files). A brand-new Starter user with zero agents opens Templates and immediately sees real examples — each card previews the **full capability description, connector pills, adoption count, and flow count** (gallery cards under `src/features/templates/sub_generated/gallery/`), not just a name+icon. The example content is concrete and role-credible (e.g. "Audio Briefing Host… turns any source document… into a 5-15 minute conversational audio briefing with two distinct hosts"). Greg's criterion #3 ("see a credible working example without building from zero") is **met structurally**, and the Templates section is **not tier-gated** (`sidebarData.ts:42`) so it's reachable on the trial. *(Senior-quality of the example — criterion #4 — needs L2 to read the seeded prompts in full; the descriptions clear the bar, the prompts are unverified at L1.)*
- **First-run consent leads with the trust contract.** Local-first + AES-256-GCM + "no data to Personas servers unless you opt into cloud" + user-supplied keys encrypted-and-never-shared + SSRF blocklist — disclosed up front, checkbox-gated, before any data is entered (`FirstUseConsentModal.tsx`, `App.tsx:304`, `en.json consent.*`). This is the right first impression for a skeptic and directly serves criterion #1.
- **Connections + Settings reachable on Starter; tier packaging is honest about what's hidden.** Connections and Settings carry no `minTier` (`sidebarData.ts:41,44`); the higher-tier sections are cleanly gated rather than half-broken.
- **Wrong-field errors are visible, not silent** (`FormActions.tsx:71-76` save-disabled reason block) — satisfies the connector journey's second DoD clause.

---

## Character voice

Give me twenty minutes and I'll tell you in the first five whether you're real. Two things impressed me and one killed the deal.

Impressive: you put the data-locality contract on the *very first screen* — local-first, AES-256-GCM, key in my OS keyring, nothing goes to your servers unless I opt into cloud. That's the right first move for someone like me, and most "enterprise-grade security" demos can't even produce that sentence. And when I went to look at quality without building anything, you'd already seeded thirteen real, fully-described example agents into the gallery — connectors, flows, a clear description of what each one does. That's exactly what I want: prove it before you make me work. My senior would at least read those.

Now the deal-killer: **what does this cost?** That's my first question on every tool, and your product cannot answer it. I went to Settings → Account expecting a plan and a price — I got telemetry toggles, a radio widget, and a Google sign-in button. The only "tiers" you have are "Simple" and "Power," which are *screen-complexity modes*, not plans. The only dollar signs anywhere are Anthropic's token rates that I'd pay Anthropic directly. So I literally cannot compare you to the Zapier line item that's annoying me, because you have no line item. For a buyer, "I couldn't find the price" isn't a soft no — it's a structural no, and it's the easiest thing on this list to fix.

Two more, smaller: the moment I'm actually pasting a secret, you tell me almost nothing — one pale-green word, and only if the field happens to be typed "password," when you've already written the full AES/keychain explanation in fourteen languages and wired it to nothing. Render it. And drop the "Commander" cosplay on the welcome screen and the nav cards that lead to locked rooms — when I'm deciding if you're a serious tool, in-jokes I don't get and dead-end doors read as a toy.

Net: the engine and the examples would survive my review. The *purchase decision* can't even start, because the price is missing. Show me the price and the standing security panel, and I move you from "interesting demo, can't evaluate" to "worth a pilot."
