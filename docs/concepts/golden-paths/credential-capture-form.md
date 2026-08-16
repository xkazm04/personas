# Golden path — the credential capture form

> Situation node: `integrations-security/credential-capture/credential-capture-form` ·
> [situation spine](../situation-spine.md) · recurrence 13 · risk **HIGH** ·
> sides **client** · convergence **mixed** ·
> dimensions: **security · ui · function · code-quality · resilience**
> Composed 2026-08-16 against `master` @ `ec1bf0359`.
>
> **Sweep.** Every place in this app where a human types a secret, read end to end:
> `sub_credentials/components/forms/*` (the vault capture form — `CredentialEditForm`,
> `EditFormFields`, `FieldCaptureRow`, `FieldCaptureHelpers`, `ConnectorCredentialModal`),
> `shared/components/forms/PasswordToggleField.tsx`, the AI-driven capture surfaces
> (`sub_catalog/.../negotiator/NegotiatorStepCardHelpers.tsx`,
> `sub_catalog/.../autoCred/steps/AutoCredReview.tsx`), the model-provider surfaces
> (`ByomApiKeyManager`, `ProviderCredentialField`, `CustomModelConfigForm`,
> `CloudConnectionForm`), the portability passphrase surfaces (`ExportSection`,
> `CredentialPortability`, `export-prototype/panels.tsx`), `QuickAddCredentialModal`,
> `WebhookConfig`, `ExtraFieldRenderers`, plus the whole write path behind them:
> `stores/slices/vault/credentialSlice.ts`, `lib/utils/platform/crypto.ts`,
> `api/vault/credentials.ts`, `hooks/utility/data/useAppSetting.ts`, and on the Rust side
> `db/src/credential_fields.rs`, `db/src/repos/resources/credentials.rs`,
> `commands/credentials/auto_cred_browser.rs`, `commands/credentials/crud.rs`.
> Census walk: **4,829** `.ts`/`.tsx` files (the runner's own `walked`).
> Data: a **read-only copy** of the operator's `personas.db` (347 MB), copied 2026-08-16.
>
> **Measured by executing, not reading.** Five headline numbers came from running something:
> 1. **The backend's sensitivity classifier was re-implemented from `credential_fields.rs`
>    and `credentials.rs:80` and replayed over all 196 live connector field entries**, then
>    compared field-by-field against what the form actually renders. The two classifications
>    disagree on **45 of 196**, and every disagreement runs the same direction (§0.1).
> 2. **The running app's web storage was read through the test-automation harness on :17320**
>    — 80 `localStorage` keys, 113,507 bytes, 0 `sessionStorage` keys — and every value
>    scanned in-page for eight real token prefixes and a labelled-assignment shape. **Zero
>    hits** (§0.4). Results were stashed in a hidden DOM node and read back, because `/eval`
>    is fire-and-forget.
> 3. The census rule's counts were reproduced by **a second, structurally independent
>    implementation** — a TypeScript-compiler AST walk over JSX attributes and
>    `ConditionalExpression` nodes, not a second regex — which agreed on **membership**, not
>    merely on the total (§9).
> 4. The rule was validated in a private scratch registry with a filename unique to this
>    composer, then **re-extracted from this finished document and re-run**: identical. The
>    full registry was **not** run.
> 5. All five sibling checkouts were opened and swept clause by clause (Warrant block).
>
> `cargo` was **not** run. **No credential was typed or transmitted, no OAuth flow was
> started, and no secret value, prefix, partial or length-of-a-single-value appears below.**
> Findings are reported as shape, column, and count.
>
> ### Sibling boundaries, settled in prose
>
> [**column-encryption-at-rest**](./column-encryption-at-rest.md) owns the secret **at rest in
> a column** and the classifier that puts it there. **Confirmed and extended in the one
> direction it did not look:** that path named `is_field_sensitive` (`credentials.rs:80`) "the
> best small piece of design in this territory" — a secret-name backstop a user- or
> AI-authored schema *cannot* downgrade, plus a fail-secure default. **This path measured
> whether the form honours the same verdict, and it does not: the backend's answer already
> crosses IPC as `CredentialFieldMeta.isSensitive` and has zero frontend consumers, while the
> form reads a different key of the same JSON object with no backstop at all** (§0.1). Where
> that path measured what leaks *into* a column, this path owns what happens *before* the
> value leaves the component.
>
> [**oauth-connect-flow**](./oauth-connect-flow.md) owns the credential a user *never types*
> — consent, callback, exchange, refresh. **Confirmed:** the two flows meet inside one
> component (`CredentialEditForm` renders `OAuthSection` beside `EditFormFields`), and the
> ref-not-state discipline this path prescribes was copied *from* `useOAuthPolling`
> (`CredentialEditForm.tsx:54-60` says so in a comment). What this path adds is the
> hand-typed half, which is the half with the classification gap.
>
> [**entity-draft-editing**](./entity-draft-editing.md) owns reseed-clobber and draft
> invalidation. **Confirmed and inverted for this leaf:** the vault capture form is one of
> the repo's *correct* reseed sites — `editedFieldsRef` (`CredentialEditForm.tsx:84-94`)
> guards each key individually and the comment names the caller that made it necessary — and
> the live measurement finds **no credential-shaped value in any of the 80 persisted
> localStorage keys**. The draft hazards that path catalogues are real; **they do not reach
> this leaf**, and reporting that as a clean result is part of the deliverable.
>
> [**secret-display-and-transfer**](./secret-display-and-transfer.md) owns the secret **in
> motion** — clipboard, export bundle, on-screen reveal of a *stored* value. The 30-second
> clipboard-wipe TTL (`FieldCaptureHelpers.tsx:16,:96-116`) and the export path
> (`data_portability.rs:9362`, `:9585`) are its territory. **This path owns only the reveal
> of a value the user typed a moment ago** — the eye toggle on the capture field, and whether
> it re-arms.
>
> [**app-settings-store**](./app-settings-store.md) owns `app_settings`. **Confirmed and
> extended:** two capture fields declared `type: 'password'` route their value into
> `app_settings` rather than `credential_fields` — `litellm_master_key` and `ollama_api_key`,
> via `useAppSetting` — so a masked input writes to a plaintext `TEXT` column and **reads the
> stored value back into the input on mount** (§7.C). Neither key is present in the 32 live
> `app_settings` rows, so the class is armed and unexercised.
>
> The **Deviations** section is a fix backlog.

---

## 0. The headline

**Every field of every connector in this app carries two independent opinions about whether
it holds a secret, in the same JSON object, written by the same author. One drives encryption
at rest; the other drives whether the characters appear on screen. They disagree on 45 of 196
fields, always in the same direction, and only one of them has a backstop.**

The backend's opinion is `sensitive`, and `is_field_sensitive` refuses to let it be
downgraded: a field whose *name* classifies as a secret is encrypted no matter what the
schema says, and an unknown key defaults to encrypted. The form's opinion is `type`, and
`type: "text"` is obeyed unconditionally — by the vault edit form, by the template quick-add
modal, and by the AI-assisted review screen, whose `type` string is chosen by a language
model following a single sentence in a prompt.

### 0.1 — The classifier the backend built a backstop for, replayed against the form

`is_field_sensitive` (`credentials.rs:80`) and `classify_field_type`
(`db/src/credential_fields.rs:97`) were re-implemented and run over the live
`connector_definitions` table — **134 connectors, 196 field entries, all `is_builtin = 1`**.
Each entry's backend verdict was then compared with what `EditFormFields.tsx:44` renders for
it:

| | count | share |
|---|---:|---:|
| backend **encrypts** + form **masks** | 119 | 61% |
| backend **encrypts** + form renders **cleartext** | **45** | **23%** |
| backend stores plaintext + form **masks** | **0** | 0% |
| backend stores plaintext + form renders cleartext | 32 | 16% |

**Zero disagreements in the safe direction.** The 45 break down as: **43** where the schema
itself says `sensitive: true` *and* `type: "text" | "url" | "select"` — two fields of one
object contradicting each other — plus **2** where the schema says `sensitive: false` on a
secret-named key and the backstop overrides it (`higgsfield.key_id`, `langfuse.public_key`).
Those two are the mechanism in miniature: **the backend refuses the downgrade and the form
accepts it.**

Honest precision: most of the 43 are semi-public identifiers (`account_id`, `domain`,
`email`, `binary_path`, `base_id`, `cdp_port`) where `sensitive: true` is the fail-secure
default doing its job and `type: "text"` is a defensible UI choice. **The catalog is
well-curated; that is not the finding.** The finding is that **nothing makes it stay that
way**, and the next 196 fields will not come from a curated seed file.

### 0.2 — Because the masking policy is a sentence in an LLM prompt

`src-tauri/src/commands/credentials/auto_cred_browser.rs:648`:

```
- Set field type to "password" for secrets/tokens, "text" for identifiers.
```

and again at `:726`. The model returns `discovered_fields: [{ key, label, type, required,
help_text }]` — **with no `sensitive` key at all**. That object is passed to the renderer as
an opaque `serde_json::Value` (`auto_cred_browser.rs:177`; the Rust `AutoCredField.field_type`
is `#[allow(dead_code)]` and never read), and `AutoCredReview.tsx:107` renders
`inputType={field.type === 'password' ? 'password' : 'text'}`.

So for an AI-discovered connector the two opinions come from *different places entirely*:
`sensitive` is absent, so the backend's fail-secure default encrypts; `type` is the model's
free choice, and it is the whole masking policy. **The exact authorship the backstop was
written to defend against reaches the form unguarded.** `is_field_sensitive`'s own doc
comment says it: *"The connector schema is user/AI-authorable, so a mis-authored
`"sensitive": false` must not be able to downgrade a real secret."* Nobody wrote the sentence
for `type`.

### 0.3 — And the repo already contains the fail-secure form, one directory away

| surface | line | masking decision | posture |
|---|---|---|---|
| **negotiator** (AI-guided step-by-step capture) | `NegotiatorStepCardHelpers.tsx:118` | `inputType="password"` — **unconditional literal** | **fail-secure** |
| vault edit form | `EditFormFields.tsx:44` | `field.type === 'password' ? 'password' : …` | fail-open |
| AI auto-cred review | `AutoCredReview.tsx:107` | `field.type === 'password' ? 'password' : 'text'` | fail-open |
| template quick-add | `QuickAddCredentialModal.tsx:355,:382` | `field.type === 'password'` | fail-open |
| the primitive itself | `FieldCaptureRow.tsx:51` | `inputType = 'text'` **default** | fail-open |

**Two AI-driven capture screens, in the same feature folder, with opposite defaults.** The
negotiator masks everything a user pastes into it because pasting a secret is the only reason
that screen exists. The auto-cred review, which shows values a browser-driving model just
extracted, asks the model what to mask. Nothing distinguishes them but the author.

`FieldCaptureRow`'s `inputType = 'text'` default is upstream of all of it: a caller who
forgets the prop gets an unmasked field, and the primitive has no way to know it was handed a
secret.

### 0.4 — Everything else about this form is good, and saying so is load-bearing

This is a **classification** defect, not a containment defect, and the reason to be confident
about that is that the containment was measured and holds.

| property | measured | verdict |
|---|---|---|
| typed secret in React state | **no** — `valuesRef` (`CredentialEditForm.tsx:61`), with a written rationale naming React DevTools and Sentry serialization, and a test pinning it (`__tests__/CredentialEditForm.test.tsx:29`) | ✔ |
| typed secret in a Zustand store | **no** — the two persisted stores' `partialize` lists 20 and 3 UI keys; no credential path | ✔ |
| typed secret in `localStorage` / `sessionStorage` | **no** — live app probed through :17320: **80 keys / 113,507 bytes / 0 sessionStorage**, scanned for 8 token prefixes + labelled assignments, **0 hits** | ✔ |
| typed secret in a persisted draft | **no** — `trigger_studio_draft_v1` (`studioDraftModel.ts:51`) is the only credential-adjacent localStorage draft and its `ChainDraft` carries links only, no trigger config | ✔ |
| typed secret crossing IPC in cleartext | **no** — `encryptWithSessionKey` (RSA session key, rotation-detecting cache, `platform/crypto.ts`) wraps the whole field map before `create_credential` (`credentialSlice.ts:154`) | ✔ |
| stored secret read *back* into the form | **no** — `CredentialFieldMeta` (`src/lib/bindings/CredentialFieldMeta.ts`) is `{id, credentialId, fieldKey, fieldType, isSensitive, createdAt, updatedAt}` — **there is no value field**; `get_decrypted_fields` has 7 Rust call sites and none returns to the renderer | ✔ **withheld by type** |
| blank field on edit = "clear the secret" | **no** — `OverviewTab.tsx:76-84` filters empty strings out of the patch and the UI says so | ✔ |
| reseed clobbering an in-progress edit | **no** — `editedFieldsRef` guards per key (`CredentialEditForm.tsx:84-94`) | ✔ |
| copied secret left on the OS clipboard | **no** — 30 s TTL wipe that only fires if the clipboard still holds *our* value, with an unconditional-clear fallback when `readText()` is denied (`FieldCaptureHelpers.tsx:96-116`) | ✔ **best in the six-repo sample** |
| a secret value in a log / toast / error string | **not found** — validation errors interpolate `field.label`; `logSecretSafeError` (`ByomApiKeyManager.tsx:18`) logs `err.name` and the settings key, never the value | ✔ |

**One of those rows is the sharpest design in this leaf and deserves naming.** The IPC read
type for credential fields carries the sensitivity verdict and **not** the value. That is
[doctrine Q5](../golden-path-doctrine.md#1--prefer-a-type-over-a-gate--and-the-seven-qualifications)
— withholding beats requiring — implemented at the wire. `ascent` has the same feature and
made the other choice: `AlertsControl.tsx:104-108` fetches a stored Slack webhook URL back
and re-displays it in an unmasked `type="url"` field. **Personas cannot commit that bug,
because the value is not on the wire to re-display.**

### 0.5 — The three things the form hands out that nobody asked for

Three signatures in this leaf give a caller more than it needs, and in each case the extra
thing is the secret:

1. **`onValuesChanged(key: string, value: string)`** (`CredentialEditForm.tsx:25`) fires on
   every keystroke with the character the user just typed. It has **8 declared consumers and
   zero read either parameter** — `useCredentialDesignOrchestrator.ts:143` names them
   `_key, _value` and calls `health.invalidate()`. Every other consumer is written
   `() => …`. The prop exists to say *"something changed"* and it hands over *what*.
2. **`allowCopy = true`** is the `FieldCaptureRow` default (`:54`) and `EditFormFields.tsx:46`
   passes it explicitly, so every credential field including secrets renders a copy button.
   (Mitigated by the clipboard TTL; still the wrong default for a field whose value the user
   just typed and can see.)
3. **`autoComplete`** defaults to **`'current-password'`** inside `PasswordToggleField`
   (`:106`), and **8 of its 11 call sites do not override it**. `current-password` tells the
   browser and every password manager *"this is a login field, offer to fill it"*. Every one
   of those 11 sites is a **new-credential capture** field, where the correct value is
   `new-password` or `off`. This is the contract's fifth failure mode exactly: a gate that
   says "use the shared primitive" is only as good as the primitive's defaults, and the
   default here is wrong in a way no call site can see.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file path,
primitive name or count, and each clause carries its warrant so an adopting repo can tell
physics from local calibration.

> **P1 — physics, and it is the whole subject.** *One fact must have one owner.* "Is this
> field a secret" is a single property of a single field, and the moment two places answer it
> — one for storage, one for display — they will diverge, silently, because neither is wrong
> at its own site and no test spans both. Compute it once, in the place that fails secure,
> and make every consumer read that answer.
>
> **P2 — physics, corollary of P1 and the clause this leaf exists to state.** *A protection
> whose input is authored by the party you are protecting against is not a protection.* If
> the schema that says "this is a secret" can be written by a user, a model, or an imported
> file, then any decision that trusts it unconditionally has delegated the decision to the
> untrusted author. Wherever you already built a backstop for one such decision, the second
> decision reading the same untrusted object needs the same backstop — and it will not have
> one, because the backstop was written as a fix for a specific bug rather than as a rule
> about a class of input.
>
> **P3 — physics.** *A secret field's default must be masked.* Defaults are the policy for
> everything nobody thought about, and everything nobody thought about is exactly where the
> next secret arrives. Over-masking an identifier costs one click; under-masking a token
> costs the token. The two errors are not symmetric and the default must not pretend they
> are.
>
> **P4 — physics.** *Withhold the value from anything that only needs the event.* A change
> notification, a validation trigger, a "mark dirty" callback and a telemetry hook all want
> to know *that* the field changed; none of them wants the character. A signature that hands
> the value to all of them creates N places a secret can be captured, and every one of them
> today is a place that discards it — which is the argument for narrowing the type, not
> against it.
>
> **P5 — physics, and the strongest single move available.** *Never make the stored secret
> retrievable by the surface that captured it.* An edit form that re-displays what it saved
> needs a read path for plaintext, and once that path exists every other feature can use it.
> Withhold the value from the read type entirely; render a "configured" marker and treat a
> blank field as *unknown*, never as *cleared*. This converts a whole class of leak into a
> compile error.
>
> **P6 — physics, learned from a repo that avoided the question.** *The safest place for a
> typed secret is nowhere.* Framework state, a form library, a global store and browser
> storage are four escalating levels of exposure, and there is a level below all of them:
> never binding the value in the host language at all. Where the platform allows an
> uncontrolled field submitted directly, that beats any discipline about which container to
> keep it in — and where it does not, a ref beats state, and state beats a store, and a store
> beats storage.
>
> **P7 — ergonomics, and it is a security clause in disguise.** *A failed save must not
> destroy what the user typed.* A secret is usually pasted from somewhere the user has now
> closed. Clearing the field on error makes them re-fetch it, and the re-fetch is the risky
> operation, not the retry. Keep the value, surface the reason, and clear only on success.
>
> **P8 — ergonomics.** *A reveal must re-hide itself.* "Show" is a request to read one value
> once, not a change of mode. Left latched, it turns a masked field into an unmasked one for
> the rest of the session, including whatever screen-share or screenshot happens next.
>
> **P9 — ergonomics, and it is the clause every team forgets.** *Tell the browser what kind
> of field this is.* A capture field for a brand-new credential is not a login field.
> Declaring it as one invites autofill of the wrong secret into the wrong service, and invites
> the password manager to save the value into a vault the user did not choose.
>
> **Scale condition.** P1, P2 and P3 bite on the first field somebody else authors — a
> plugin, an import, a model. P5 bites the first time anyone builds an "edit" screen. P4 and
> P6 are correctness on the first field. P7 bites the first network failure. P8 and P9 bite
> immediately and quietly, and are the two nobody reports.

### Warrant evidence — the five siblings, censused 2026-08-16

`personas-web` (Next.js), `brainiac` (Rust workspace + Next.js console), `personas-cloud`
(TS orchestrator + Python facade), `vibeman` (Next.js + Tauri), `ascent` (Next.js + GitHub
App). **All five checkouts exist and were opened. Nothing below is reported by omission.**

**Only two of the five contain a form where a human types a secret**, and the three that do
not were each checked rather than assumed: `personas-web` has 14 typed inputs (12 `text`, 1
`number`, 1 `email`) and none is a secret; `vibeman` has 90 raw `<input>` elements, **zero**
with a credential-named prop and zero `type="password"` anywhere under `src`;
`personas-cloud` has no UI at all. **So every denominator below that reads "of 5" is really
"of 2 that could have had it", and that is stated per row.**

| clause | personas-web | brainiac | personas-cloud | vibeman | ascent | verdict |
|---|---|---|---|---|---|---|
| has a secret-capture form | ✘ | **✔** (1) | ✘ | ✘ | **✔** (4 surfaces) | **2 of 5** |
| **P3** secret field is masked | n/a | ✔ 1/1 | n/a | n/a | ✔ 2 of 3 — a Slack webhook URL is `type="url"` (`AlertsControl.tsx:214`) | **partial, 2 of 2** |
| **P1** one classifier shared by form and backend | ✘ none exists | ✘ Rust-only | ✘ | ✘ | ✘ | **0 of 5 — see (a)** |
| **P4** change callback withholds the value | n/a | n/a (uncontrolled) | n/a | n/a | n/a — inline `onChange` | **SILENT** |
| **P5** stored secret never re-displayed | n/a | ✔ | ✘ API re-serves | n/a | **both** — `ApiTokensPanel.tsx:87` is best-in-corpus, `AlertsControl.tsx:104-108` re-displays | **split, 1.5 of 2** |
| **P6** secret never enters host-language state | n/a | **✔ uncontrolled `<form action>`** (`login/page.tsx:82`) | n/a | n/a | ✘ plain `useState` | **1 of 2 — see (b)** |
| **P7** value survives a failed save | n/a | n/a | n/a | n/a | **✔ by accident** — clears after the throw | **convergent, 2 of 2** |
| **P8** reveal toggle exists **and** re-hides | ✘ | ✘ | ✘ | ✘ | ✘ | **0 of 5 — no repo has a reveal toggle at all** |
| **P9** `autoComplete` declared correctly | ✘ | **✔ `current-password`** on a real login | ✘ | ✘ | ✔ `off` ×3, **✘ none on the webhook field** | **1 of 2** |
| a shared secret-input primitive | ✘ | ✘ | ✘ | ✘ | ✘ | **0 of 5 — Personas is alone** |
| credential-shaped value in client storage | ✘ | ✘ (rejected in writing) | **✘✘ git-tracked log** | **✘✘ plaintext localStorage vault** | ✘ | **2 live leaks, neither in Personas** |

**Five results this document rests on.**

**(a) The headline defect is a unanimous ABSENCE, and Personas is the only repo that already
built the thing it fails to use.** Four of five repos have a sensitivity classifier —
`vibeman/src/lib/logger.ts:27` `SENSITIVE_KEYS` (114 importers), `ascent`'s `SECRET_PATTERNS`
(`src/lib/llm/eval-log.ts:36`), `brainiac`'s `redact.rs`, and Personas' own
`classify_field_type`. **All four are output-side — redaction of something already produced —
and not one of them is consulted by a form.** `vibeman`'s is imported by 114 modules and
**zero `.tsx` files**. And **no repo in the fleet has a schema-level `sensitive` flag shared
between a form and a backend** — except Personas, which has one on the wire
(`CredentialFieldMeta.isSensitive`) with **zero frontend consumers**. That makes P1/P2
*strongly-reasoned and externally untested as a practice*, and simultaneously the
best-evidenced kind of finding the corpus recognises: **the fix is not "build a classifier",
it is "read the one you already ship".**

**(b) P6 has a warrant Personas does not, and it is stronger than what Personas does.**
`brainiac/console/app/login/page.tsx:82` submits its passcode through
`<form action={login}>` with an **uncontrolled** `name="passcode"` input — the secret never
enters JavaScript state, so "which container holds it" and "is it cleared" become unaskable
rather than merely answered. Personas' `valuesRef` is the second-best answer and it was
reached by a different route (copying the OAuth hooks' DevTools/Sentry rationale). `ascent`
is the control that makes the clause bite: four secret surfaces, all plain `useState`.

**(c) P8 is a genuine Personas-only invention and must be reported as that, not as
validated.** **Zero of the five siblings have a reveal toggle on any secret field.** Personas
has two implementations — `PasswordToggleField` with an **8-second auto-revert that re-arms
on blur** (`:31,:61-78`), and `FieldCaptureRow`'s eye button which **latches until unmount**
(`:61,:88-89`). The auto-revert is the better half of a clause nobody else has, and the
latching half is a deviation against Personas' own better idea, not against the fleet.

**(d) P7 is convergent, by two codebases reaching it from opposite intentions.** `ascent`
retains the secret on a failed save *because* its `setKey('')` calls sit below an
`if (!res.ok) throw` (`LlmProviderSettings.tsx:55-57`, `OpenRouterByomSettings.tsx:55`) —
correct behaviour arrived at by control-flow accident. Personas retains it because
`valuesRef` outlives a rejected promise and nothing clears it. **Two repos, same correct
outcome, neither by decision.** That is exactly why P7 belongs in a golden path: it is right,
and nobody has written it down.

**(e) Two absences that are unanimous across all five, including Personas.** **Zero
`data-1p-ignore`, zero `data-lpignore`, zero `data-bwignore`, and zero `onPaste` handlers on
any secret field, in any of the six repos.** Personas confirms the pattern: 4,829 files, 0 of
each; the only three `onPaste` occurrences are a button prop on the API-explorer empty state.
So P9's password-manager half is a **fleet-wide gap**, and this document must not claim it as
doctrine anyone has validated — only that the browser is being told the wrong thing (§7.E)
and nobody anywhere is telling it the right one.

**And two live leaks worth importing as hazards, neither of which Personas has.**
`vibeman/src/lib/llm/llm-storage.ts:39,107` is a **plaintext `llm_api_keys` localStorage
vault with three live readers and zero writers** — a loaded sink waiting for a UI, and its own
`.planning/` docs still instruct a future session to build that UI. And `personas-cloud`
committed `worker-debug.log` to git containing two OAuth-token-shaped strings, because
`.gitignore` covers `.env` and not `*.log`. **A credential form is not only a place a secret
enters; it is the moment a repo decides where secrets are allowed to live, and both siblings
lost that decision to a default.**

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "add a field for the API key" · "the user needs to paste their token here"
- "let people connect &lt;service&gt; with a key instead of OAuth"
- "we need a settings input for the &lt;provider&gt; API key"
- "add a passphrase field to the export/import dialog"
- "make the connector form show these fields"
- "the model will discover the fields — just render whatever it returns"
- "why is the key showing in plain text?"

**If you are about to write** `type="password"`, `type={… ? 'password' : …}`,
`inputType="password"`, `autoComplete=` on anything credential-shaped, an `<input>` whose
label contains *key* / *token* / *secret* / *password* / *passphrase*, a `useState` that will
hold a pasted credential, an `onChange` that forwards a field value upward, a
`fields: [{ key, label, type }]` schema, **or a prompt that asks a model to describe a
credential form** — **you are in this situation.**

**You are also in it, and this is the case people miss, when you are about to add a `sensitive`
or `secret` boolean to a schema.** You have just created a second opinion about a fact that
already has one (§0.1). Say which one wins, in the same change.

**And you are in it if you are about to build an "edit credential" screen.** The decision you
are about to make — whether the form loads the stored value — is the one decision in this leaf
that a type can make for you permanently (§4).

**Not this path:** the secret at rest in a column is
[column-encryption-at-rest](./column-encryption-at-rest.md); a credential obtained without
typing is [oauth-connect-flow](./oauth-connect-flow.md); *showing* or exporting a **stored**
secret is [secret-display-and-transfer](./secret-display-and-transfer.md); whether the
credential works is [connection-health-check](./connection-health-check.md); whether a persona
may run is [credential-readiness-resolution](./credential-readiness-resolution.md); generic
label/error/validation mechanics are [form-field](./form-field-and-validation.md).

---

## 2. The one way

**Decide sensitivity in exactly one place, make that place fail secure, and make the form read
it.** The decision already exists and already fails secure — `is_field_sensitive`
(`credentials.rs:80`) with its name backstop and its encrypt-by-default for unknown keys — and
its verdict already crosses IPC on `CredentialFieldMeta.isSensitive`. **Bind the input's
masking to that verdict, never to the schema's `type` string**, because `type` is authored by
whoever wrote the connector — a user, an import, or the model at
`auto_cred_browser.rs:648` — and a masking decision that trusts an untrusted author is not a
decision. Until the verdict is wired, **make the primitive's default masked**: flip
`FieldCaptureRow`'s `inputType` default from `'text'` to `'password'` and require callers to
opt *out* for identifiers, so the field nobody thought about is the field that is covered.
**Hold the typed value in a ref, never in `useState`, never in a store, never in web storage**
— `CredentialEditForm.tsx:61` is the shape to copy and its comment is the reason — and
**withhold it from every callback that only needs the event**: `onValuesChanged` should be
`() => void`, because all eight of its consumers already discard both arguments. **Encrypt
before the IPC boundary** with `encryptWithSessionKey`, and **never give the renderer a way to
read a stored secret back** — `CredentialFieldMeta` carries `isSensitive` and no value, and
that omission is what makes the whole edit flow safe; keep it. On edit, treat a blank field as
*unknown*, not as *cleared*, and filter empties out of the patch
(`OverviewTab.tsx:76-84`). **On a failed save, keep what the user typed and show why** —
they pasted it from somewhere they have closed. **Clear on success only, and clear the
clipboard too** if you offered a copy button (`FieldCaptureHelpers.tsx:96-116`). Give the
reveal toggle an **auto-revert** (`PasswordToggleField`'s 8 s, re-armed on blur) rather than a
latch, and set `autoComplete="new-password"` or `"off"` — **never `current-password`**, which
is what the shared primitive defaults to today and what 8 of its 11 call sites therefore ship.

If you must get one thing right first: **make the default masked.** Every other clause here
protects a field somebody already recognised as a secret. The default protects the ones
nobody did, and that is where the next 196 fields are coming from.

---

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
|---|---|
| `features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:61` | **the reference capture form.** Typed values in a `useRef` + version counter, never `useState`; per-key `editedFieldsRef` so a reseeding parent cannot clobber an in-progress edit; validation gated before every exit (`save` / `healthcheck` / `oauth consent`); a comment at `:54-60` naming React DevTools and Sentry serialization as the reason |
| `…/forms/FieldCaptureRow.tsx` | the credential-field row: label, required marker, help text, error, `aria-invalid` + `aria-describedby`, validation glow, and the eye/copy/paste action cluster. **Its `inputType` default is `'text'` — see §7.A** |
| `…/forms/FieldCaptureHelpers.tsx:96-116` `FieldActionButtons` | **the clipboard TTL, and it is the best in the six-repo sample.** Copies, then after 30 s re-reads the clipboard and clears it **only if it still holds our value**; when `readText()` is denied it falls back to an unconditional clear rather than skipping the wipe, with the reasoning written down |
| `…/forms/FieldCaptureHelpers.tsx:20` `computeValidationGlow` | paste-quality feedback for a secret without ever showing it: warns on `< 8` chars or interior whitespace (the paste-error shape), green otherwise |
| `shared/components/forms/PasswordToggleField.tsx:31,:61-78` | the masked-input primitive with an **8-second auto-revert that re-arms on blur and pauses while focused** — a clause no sibling repo has. `pr-10` reserves space so text never slides under the icon. **Its `autoComplete` default is wrong — see §7.E** |
| `src/lib/bindings/CredentialFieldMeta.ts` | **the read type, and the sharpest design in this leaf.** `{id, credentialId, fieldKey, fieldType, isSensitive, createdAt, updatedAt}` — **no value field**, so no renderer can display a stored secret and no future feature can start. It also already carries the backend's `isSensitive` verdict |
| `stores/slices/vault/credentialSlice.ts:150` `createCredential` | splits the OAuth session ref out, `encryptWithSessionKey`s the field map, sends `encryptedData: ""`, and appends optimistically. The plaintext object never leaves the closure |
| `lib/utils/platform/crypto.ts` `encryptWithSessionKey` | RSA session-key wrapping with a rotation-detecting cache (60 s PEM re-check, shared in-flight refresh) and a documented failure mode for the stale-key case |
| `db/src/repos/resources/credentials.rs:80` `is_field_sensitive` | **the one true classifier.** Secret-name backstop that a user/AI schema cannot downgrade → schema flag → fail-secure default. `warn!`s the misconfiguration and never the value |
| `db/src/credential_fields.rs:97` `classify_field_type` / `:18` `NON_SENSITIVE_KEYS` | the shared vocabulary the classifier reads, deliberately the **strict union** of three formerly-independent copies, with the drift risk recorded in its own doc comment |
| `sub_catalog/.../negotiator/NegotiatorStepCardHelpers.tsx:118` | **the fail-secure capture row.** `inputType="password"` unconditionally, `allowPaste` on, per-field test ids. Copy this posture |
| `shared/playground/tabs/OverviewTab.tsx:76-84` | the write-only edit patch: blank means *unknown*, only non-empty fields are submitted, and the UI explains it |

**Do not exist — this path names them:**

- **Any frontend consumer of `CredentialFieldMeta.isSensitive`.** Zero, in 4,829 files. The
  backend's verdict crosses the wire and nothing reads it.
- **Any frontend port of `classify_field_type`.** The name backstop exists only in Rust.
- **Any masked default.** Both `FieldCaptureRow` (`inputType = 'text'`) and every bare
  `<input>` default to visible.
- **Any `autoComplete` policy.** One default (`'current-password'`, and wrong), three
  hand-written `"off"`s, and 12 secret-bearing inputs with nothing at all.
- **Any paste handling on a secret field.** Zero `onPaste`, zero password-manager opt-outs
  (`data-1p-ignore` / `data-lpignore` / `data-bwignore`) — matching all five siblings.
- **Any single "capture a credential" component.** Five independent capture surfaces
  (`FieldCaptureRow`, `PasswordToggleField`, `QuickAddCredentialModal`'s inline input,
  `ExtraFieldRenderers`' KV row, `WebhookConfig`'s inline input), each with its own eye
  toggle, its own default, and its own `autoComplete` story.

---

## 4. Steps

1. **Before writing any JSX, find the fail-secure classifier and confirm it reaches you.**
   In this repo it is `is_field_sensitive`, and its verdict is already on
   `CredentialFieldMeta.isSensitive`. If your form has a different source of truth, you have
   two, and §0.1 is what that costs.
2. **Make the masked state the default.** `inputType`/`type` should require an explicit
   opt-out for identifiers, not an explicit opt-in for secrets. If you cannot change the
   primitive today, pass the prop at every call site and add the call-site count to your PR
   description so the next person can see the tax.
3. **Never derive masking from a schema field an untrusted author writes.** If a model or a
   user supplies `type`, treat it as a *hint* that can only ever upgrade to masked, never
   downgrade — the exact asymmetry `is_field_sensitive` already implements for encryption.
4. **Hold the value in a ref.** `useRef<Record<string,string>>` + a version counter for
   re-render (`CredentialEditForm.tsx:61-69`). Not `useState`, not a store, not
   `localStorage`, not a persisted draft. If your platform offers an uncontrolled field
   submitted directly to a server action, prefer that — it is strictly better (P6).
5. **Ask the type question now**, before §9. The answer for this leaf is below and it is
   two small signature edits, one of which has already been made and is the reason this
   document has a short containment section.
6. **Withhold the value from every callback that only needs the event.** A change hook, a
   dirty flag, a validation trigger and an invalidate-the-healthcheck call all take
   `() => void`.
7. **Encrypt before IPC.** `encryptWithSessionKey(JSON.stringify(fields))`. Never send a
   credential map as a plain command argument, even locally — the argument is serialised
   through the webview bridge and is exactly the kind of value an error path stringifies.
8. **Give the read path no value to return.** The list/meta type carries `isSensitive` and
   not the secret. On edit, render "configured" and treat blank as unknown; filter empties
   out of the patch so a blank cannot clear a good secret.
9. **On failure, keep the value and surface the reason.** Bind the error (`catch (err)`, not
   `catch {}`), resolve it through the error registry, and render it. Clear the field only on
   success — and if you offered a copy button, clear the clipboard too.
10. **Set `autoComplete` deliberately.** `new-password` or `off` for capture;
    `current-password` only on an actual login. Add the password-manager opt-outs if the
    platform respects them.
11. **Make the reveal expire.** Auto-revert on a timer that re-arms on blur, never a latch
    that survives until unmount.
12. **And then stop.** Do not add a sixth capture component, a second sensitivity vocabulary,
    a client-side copy of the name backstop that can drift from the Rust one, or a "remember
    my key" convenience.

### Can the type make the wrong call impossible? — asked before §9

**Yes, twice, and one of the two has already been done — which is the most useful thing this
section can report, because it is why §0.4 is a list of green rows.**

**Already shipped: `CredentialFieldMeta` has no value field.** Held against the
qualifications: **Q5 (withholding beats requiring)** — the renderer is not given the
dangerous value at all, rather than being asked to handle it carefully. **Q6 (withhold the
dangerous freedom, not the answer)** — it still gets `fieldKey`, `fieldType` and
`isSensitive`, everything needed to render the form; only the secret is withheld. **Q3 (a
type nobody constructs constrains nothing)** — it is constructed in Rust by
`list_credential_fields` (`crud.rs:460`) and consumed by the vault UI, so it is live. The
measurable result is that `ascent`'s re-display bug (`AlertsControl.tsx:104-108`) is
**unrepresentable here**. Do not weaken this type.

**Not shipped, and it is one line: narrow `onValuesChanged`.**

```ts
// CredentialEditForm.tsx:25 — today
onValuesChanged?: (key: string, value: string) => void;
// the fix
onValuesChanged?: () => void;
```

- **Q5.** This is the canonical form: do not hand the caller the secret. It is the
  `KanbanBoard.onItemMove` case verbatim — the callback's job is to say *something changed*,
  and the value is the dangerous freedom.
- **Q3 (count the construction sites).** **8 call sites, 0 of which read either parameter.**
  `useCredentialDesignOrchestrator.ts:143` writes `(_key: string, _value: string)`; the other
  seven are written `() => …`. **The narrowing is a no-op at every existing call site** —
  which is precisely why it is worth doing now, before the ninth consumer.
- **Q6.** Correct: the event survives, the value does not. `health.invalidate()` and
  `oauth.reset()` need neither argument.
- **Q7 (withholding a requirement is inert when the caller supplies the bad value
  voluntarily) — the honest limit, and it is the one that matters.** Narrowing
  `onValuesChanged` closes the *callback* leak. It does **not** touch §0.1, because the
  masking bug is not a value being passed to the wrong place — it is a boolean being read
  from the wrong source. **No signature change makes `type: "text"` mean "masked".** The fix
  there is a *default* (`inputType = 'password'`) plus a *read* (`isSensitive`), and
  pretending the type covers it is the mistake this qualification exists to prevent.
- **Q1.** `onValuesChanged: () => void` encodes "changed" and nothing more. It does not
  encode *which* field changed — if a future consumer genuinely needs that, pass the **key**
  and never the value, which is the same asymmetry as Q6.

**Where the type cannot reach.** The masking decision's input is **a string inside a JSON
column authored by a language model** (`connector_definitions.fields`, populated for AI
connectors from the prompt at `auto_cred_browser.rs:648`). That is the doctrine's first
unreachable case one layer out: not a SQL string literal but a *schema value*, carried
end-to-end as `serde_json::Value` (`auto_cred_browser.rs:177`) precisely so nothing has to
type it. No Rust or TypeScript signature can constrain what a model writes into `"type"`.
**The only instruments that reach it are a fail-secure default and a runtime upgrade rule** —
which is why §2 leads with the default and §9 gates the derivation rather than the data.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Two sensitivity opinions in one schema object** (`sensitive` for storage, `type` for display) | Neither site is wrong alone; no test spans both. **Measured: 43 of 196 live fields declare `sensitive: true` and a non-password `type` — the same object contradicting itself — and 2 more where the backend's backstop overrides `sensitive: false` while the form obeys it.** Zero disagreements in the safe direction. |
| **`type={schemaField.type === 'password' ? 'password' : 'text'}`** | Delegates a security decision to whoever authored the schema. **3 live sites** (`EditFormFields.tsx:44`, `AutoCredReview.tsx:107`, `QuickAddCredentialModal.tsx:382`), one of which renders fields whose `type` a model chose. The compliant sibling is 8 lines away: `NegotiatorStepCardHelpers.tsx:118` writes the literal. |
| **A secret-input primitive whose masking prop defaults to unmasked** | `FieldCaptureRow.tsx:51` — `inputType = 'text'`. A caller who forgets the prop ships a visible token and nothing anywhere reports it. The default is the policy for every field nobody thought about, and that is where the next secret arrives. |
| **Asking a model to decide what to mask** | `auto_cred_browser.rs:648`, `:726` — *"Set field type to `password` for secrets/tokens, `text` for identifiers."* The output object carries **no `sensitive` key at all**, so the backend defaults to encrypted while the form defers to the model. **This is the exact authorship `is_field_sensitive`'s doc comment says a backstop exists to defend against.** |
| **A change callback that carries the value** | `onValuesChanged(key, value)` — **8 consumers, 0 read either argument.** Every one is a place a keystroke of a secret could be captured, logged or memoised, and today every one throws it away. The signature is the liability, not the consumers. |
| **`catch {}` on a credential save** | `useCatalogHandlers.ts:104-106` — `catch { setError('Failed to create credential'); }`. The binding is dropped, so vault-locked, encryption-failed, duplicate-name and IPC-timeout are one message; the message is a **hardcoded English literal** in a 14-locale app; and `resolveErrorTranslated` is never reached. `custom/no-silent-catch` does not fire because the block has a body. |
| **A reveal toggle that latches** | `FieldCaptureRow.tsx:61,:88-89` — `isVisible` flips and stays flipped until unmount. The repo's *other* secret input already solved this (`PasswordToggleField`'s 8 s auto-revert, re-armed on blur, paused while focused). Two primitives, one clause, opposite answers. |
| **`autoComplete="current-password"` on a capture field** | `PasswordToggleField.tsx:106` makes it the **default**, and **8 of 11 call sites inherit it**. It tells the browser and every password manager that a brand-new API-key field is a login password field — inviting autofill of an unrelated secret and a save into a vault the user did not choose. A wrong default is worse than no default: no call site can see it. |
| **Routing a `type: 'password'` field into the general settings store** | `ProviderCredentialField.tsx` → `useAppSetting` → `app_settings`, a plaintext `TEXT` column, for `litellm_master_key` and `ollama_api_key`. It also **reads the stored value back into the input on mount** (`useAppSetting.ts:47-58`) — the one re-display path in the app, and it exists because the value never went through `credential_fields`. |
| **Clearing the field on a failed save** | Not committed here, and named so it stays that way. The user pasted the secret from a page they have closed; clearing forces a re-fetch, and the re-fetch is the risky operation. `ascent` gets this right by accident (its `setKey('')` sits below a `throw`); make it deliberate. |
| **A copy button on a field the user is currently typing into** | `allowCopy = true` is the `FieldCaptureRow` default and `EditFormFields.tsx:46` passes it. The clipboard TTL makes it survivable; it is still the wrong default for a value that is visible on screen and one keystroke from being re-typed. |
| **Five capture components** | `FieldCaptureRow`, `PasswordToggleField`, `QuickAddCredentialModal`'s inline input, `ExtraFieldRenderers`' KV row, `WebhookConfig`'s inline input. Five eye toggles, three `autoComplete` stories, two defaults. **No sibling repo has even one shared primitive — so the fix is consolidation, not invention.** |

---

## 6. Evidence

### The one site to copy — `CredentialEditForm.tsx:54-99`, the ref-not-state form

It is the best-reasoned component in this territory and every property is deliberate. Typed
values live in `valuesRef` with `setValuesVersion` as the re-render trigger, and the comment
at `:54-60` states *why* — "to avoid exposing them via React DevTools / Sentry error
serialization" — and names the OAuth hooks it was copied from, so the two halves of the
credential-capture problem share one discipline. `editedFieldsRef` (`:84-94`) makes the reseed
effect per-key rather than wholesale, with the caller that forced it named in the comment
(`googleOAuth.getValues()` returning a fresh object identity every render). Validation runs
before *every* exit — save, healthcheck **and** OAuth consent (`:134-136`) — so an
unvalidated field cannot reach a network call by the back door. And there is a test pinning
the invariant (`__tests__/CredentialEditForm.test.tsx:29`, "secret values held in a ref, not
useState"). **Copy the whole shape, including the comments and the test name.**

Second site to copy, for the *type* half: **`src/lib/bindings/CredentialFieldMeta.ts`** — the
read type with `isSensitive` and no value. It is the reason `ascent`'s re-display bug cannot
happen here, and it cost one omitted field.

Supporting exemplars, each for one property:

| site | the property to copy |
|---|---|
| `NegotiatorStepCardHelpers.tsx:118` | **`inputType="password"` as a literal.** A capture surface whose only purpose is receiving pasted secrets does not ask a schema what to mask |
| `FieldCaptureHelpers.tsx:96-116` | a clipboard TTL that **verifies before clearing** (never tramples a later copy) and **clears unconditionally when it cannot verify** — the failure direction is toward the guarantee, with the reasoning written down. Ahead of all five siblings |
| `PasswordToggleField.tsx:61-94` | a reveal that **expires**: timer cleared on focus, re-armed on blur, and only if focus left the wrapper entirely so tabbing to the toggle does not re-mask mid-glance |
| `OverviewTab.tsx:65-84` | blank = *unknown*, not *cleared*; empties filtered out of the patch; and the user is told, in the UI, what a blank field means |
| `credentialSlice.ts:150-165` | encrypt-then-send: the plaintext map never escapes the closure, `encryptedData: ""` documents that the other field carries it, and the optimistic append uses the returned metadata, not the input |
| `credentialSlice.ts:179-195` | the 2026-08-15 metadata-wipe fix, kept as a **comment explaining which nulls are inert and which is destructive** — `Option<Option<String>>` with `double_option` — so the next editor cannot re-introduce it by symmetry |
| `platform/crypto.ts:14-38` | a session-key cache that detects backend rotation without backend signalling, with the indistinguishable-error failure mode it prevents written out |
| `db/src/credential_fields.rs:1-14` | a classifier module whose doc comment records that triplicating it *"is a real encrypt-vs-plaintext-at-rest risk"*. **This document is the sequel: the fourth copy is the form, and it is in another language** |

### The capture surface, measured (2026-08-16 @ `ec1bf0359`)

| | value |
|---|---:|
| `.ts`/`.tsx` files walked | **4,829** |
| secret-bearing input sites (masked) | **17** |
| …rendered through a shared primitive (`PasswordToggleField` / `FieldCaptureRow`) | 15 |
| …hand-rolled inline `<input type={… 'password'}>` | 3 (`QuickAddCredentialModal`, `ExtraFieldRenderers`, `WebhookConfig`) |
| distinct capture components | **5** |
| distinct eye-toggle implementations | **3** (`PasswordToggleField`, `FieldActionButtons`, `ExtraFieldRenderers`) |
| …with an auto-revert | **1** |
| `PasswordToggleField` call sites | **11** |
| …passing `autoComplete` | **3** (all `"off"`) — **8 inherit `'current-password'`** |
| `autoComplete` on the 12 other secret-bearing inputs | **1** (`QuickAddCredentialModal.tsx:386`) |
| `onPaste` handlers on a secret field | **0** |
| `data-1p-ignore` / `data-lpignore` / `data-bwignore` | **0 / 0 / 0** |
| frontend consumers of `CredentialFieldMeta.isSensitive` | **0** |
| `onValuesChanged` consumers reading either argument | **0 of 8** |

### The two classifications, replayed over the live catalog

| | value |
|---|---:|
| `connector_definitions` rows | **134** (all `is_builtin = 1`; **0** user/AI-authored live) |
| field entries across them | **196** |
| …with no `sensitive` key at all (backend defaults to encrypt) | **12** |
| backend encrypts + form masks | 119 |
| **backend encrypts + form renders cleartext** | **45** |
| …of which the schema itself declares `sensitive: true` with a non-password `type` | **43** |
| …of which the backstop overrides a declared `sensitive: false` | **2** (`higgsfield.key_id`, `langfuse.public_key`) |
| backend plaintext + form masks | **0** |
| secret-*named* keys (by `classify_field_type`) rendered unmasked | **9** — all `*_key_id` / `*_token_id` / `public_key` / `consumer_key` identifier variants |

**The last row is the honest limit and it is worth stating plainly: the curated catalog does
not currently expose a real token in cleartext.** Every one of the 9 is a semi-public
identifier. The defect is structural, not live: **nothing prevents the next one**, and the
next one arrives from `auto_cred_browser.rs`, not from a reviewed seed file.

### Behavioural probes, executed

1. **The running app's client storage is clean.** Probed through the test-automation harness
   on :17320: **80 `localStorage` keys, 113,507 bytes, 0 `sessionStorage` keys**. Every value
   tested in-page against eight real token prefixes (`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`,
   `sk-ant-`, `AKIA…`, `xox[baprs]-`, `AIza…`) and a labelled-assignment shape:
   **0 flagged.** The result was stashed in a hidden DOM node and read back with `/query`,
   because `/eval` is fire-and-forget.
2. **No persisted store can carry a credential.** `persona-ui-system` and `persona-ui-agents`
   are the only two `persist()` stores under `src/stores`; their `partialize` returns 20 and 3
   UI-preference keys respectively, none on a credential path.
3. **The only credential-adjacent localStorage draft carries no credential.**
   `trigger_studio_draft_v1` (`studioDraftModel.ts:51`) persists `ChainDraft = {version, links}`
   — sources, targets and conditions. The webhook HMAC secret typed at `WebhookConfig.tsx:37`
   lives in `TriggerAddForm`'s state and never enters the draft.
4. **No IPC command returns a decrypted field value to the renderer.**
   `get_decrypted_fields` has **7** call sites in `src-tauri/src/commands`; five are
   server-side consumers (OCR, GitLab, twin, icon-gen, approvals) and two are the export
   bundle (`data_portability.rs:9362`, `:9585`), which belongs to
   [secret-display-and-transfer](./secret-display-and-transfer.md). None reaches a command
   return type.
5. **The two redactor fixes the brief primed have landed and were verified in place.**
   `maskSensitive.ts:85-101` now carries per-class forms with `gh[pousr]_`, `sk-ant-`,
   `AIza`, `xox[baprs]-`, `AKIA` and the JWT triple, with the old broken literal quoted in
   the comment; `main.rs:201-218` (the **Sentry** scrubber) carries the byte-identical
   corrected form under a doc comment recording the same. Both are dated 2026-08-15.
6. **The credential-rename metadata wipe is fixed and documented at the door.**
   `src/api/vault/credentials.ts:26-41` — `updateCredential` now takes
   `Partial<UpdateCredentialInput>`, with the `Option<Option<String>>` / `double_option`
   mechanism and the "18 of 18 keys lost across 3 live rename payloads" measurement recorded
   in the comment. `credentialSlice.ts:179-195` carries the matching note on which nulls are
   inert.
7. **Two `type: 'password'` fields bypass the vault entirely.** `litellm_master_key` and
   `ollama_api_key` route through `useAppSetting` into `app_settings`. **Neither is present in
   the 32 live rows**, so the class is armed and unexercised — the same posture
   `column-encryption-at-rest` §7 P6 found for the JSON `_enc` convention.

---

## 7. Deviations

Every entry is live on `master` @ `ec1bf0359`.

> **Second pass — what is upstream of all of this.** Seven of the eight entries below reduce
> to one structural fact: **this repo has a fail-secure classifier and a fail-open form, and
> the classifier's answer is already on the wire.** `is_field_sensitive` refuses a downgrade
> and defaults to encrypted; `CredentialFieldMeta.isSensitive` carries that verdict to the
> renderer; and **zero frontend files read it**, while three read `schemaField.type` instead
> and the primitive under them defaults to visible. **A and B are the same edit twice** —
> flip one default, read one boolean — and together they close A, B, and the structural half
> of D.

### P0 (A) — the masking primitive defaults to unmasked, and three call sites delegate the decision to untrusted data

| Path | What's wrong |
|---|---|
| `src/features/vault/sub_credentials/components/forms/FieldCaptureRow.tsx:51` | `inputType = 'text'` — the default for a **credential** field row is visible. A caller who omits the prop ships an unmasked secret with no signal anywhere. |
| `…/forms/EditFormFields.tsx:44` | `inputType={field.type === 'select' ? 'select' : field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}` — masking derived from the connector schema's `type`, with `'text'` as the fallthrough. |
| `src/features/vault/sub_catalog/components/autoCred/steps/AutoCredReview.tsx:107` | `inputType={field.type === 'password' ? 'password' : 'text'}` where `field.type` was **chosen by a language model** (`auto_cred_browser.rs:648`). |
| `src/features/templates/sub_generated/adoption/QuickAddCredentialModal.tsx:355,:382` | `isPassword = field.type === 'password'` → `type={isPassword ? 'password' : 'text'}`. Same derivation, hand-rolled input. |

**Measured:** 45 of 196 live connector field entries are encrypted at rest and rendered in
cleartext; 0 the other way. The compliant form exists in the same feature folder
(`NegotiatorStepCardHelpers.tsx:118`, an unconditional literal).

**Fix, in order:** (1) flip `FieldCaptureRow`'s default to `inputType = 'password'` and pass
`'text'` explicitly for the 32 genuinely-public fields — the failure direction becomes
over-masking, which costs one click; (2) change the three derivations to *upgrade only*:
`const masked = fieldMeta?.isSensitive ?? true || field.type === 'password'` — i.e. consult
the backend verdict already on `CredentialFieldMeta`, and let the schema's `type` raise
masking but never lower it; (3) for the create flow, where no `CredentialFieldMeta` row
exists yet, port `classify_field_type`'s name check to a shared TS helper **generated from or
tested against** the Rust list, so the fourth copy of that vocabulary cannot drift the way the
first three did (`db/src/credential_fields.rs:1-14` records exactly that history).

### P0 (B) — the backend's sensitivity verdict crosses IPC and nothing reads it

`src/lib/bindings/CredentialFieldMeta.ts` exports `isSensitive: boolean`, produced by
`list_credential_fields` (`crud.rs:460`) from `is_field_sensitive`. **Frontend consumers:
0**, in 4,829 files. (The only `isSensitive` occurrences in `src` are
`api/signing/index.ts:82,:87`, an unrelated `isSensitivePath` for file paths.)

This is the contract's "gate that points at a broken destination", inverted: the *destination
is correct and nobody arrives*. It is also the corpus's recurring shape —
`record_oauth_refresh()` with zero callers, `HealthProbeState` with zero callers — a typed
answer sitting complete beside a string-keyed bypass that runs every day.

**Fix:** one `useMemo` in `EditFormFields` joining `fields` to the `listCredentialFields`
result by `fieldKey`, and pass `isSensitive` down. The IPC call already exists
(`api/vault/credentials.ts:109`).

### P1 (C) — two `type: 'password'` fields write to the plaintext settings store and read back

| Path | What's wrong |
|---|---|
| `src/features/agents/sub_model_config/components/ProviderCredentialField.tsx:63,:78,:97` | renders `PasswordToggleField` bound to `useAppSetting(settingKey)`. |
| `src/features/agents/sub_model_config/components/LiteLLMConfigField.tsx:12` | `field2 = { settingKey: 'litellm_master_key', type: 'password' }`. |
| `src/features/agents/sub_model_config/components/OllamaApiKeyField.tsx:15` | `field1 = { settingKey: OLLAMA_API_KEY_SETTING /* 'ollama_api_key' */, type: 'password' }`. |
| `src/hooks/utility/data/useAppSetting.ts:47-58` | on mount, `getAppSettingCoalesced(key)` → `setValueRaw(val)` — **the stored value is fetched back and rendered into the input.** |

Two consequences. First, a field the UI declares a password lands in `app_settings`, a
plaintext `TEXT` column with no IV — bypassing `credential_fields`, the classifier, the
round-trip verification and the audit log. Second, **this is the app's one re-display path**:
the very thing `CredentialFieldMeta`'s missing value field makes impossible for vault
credentials is routine here, because `app_settings` has a generic string reader.

**Live: neither key is among the 32 rows in `app_settings`**, so the class is armed and
unexercised. `browser_bridge_pairing_token` (32 chars) is the live proof the column does hold
shared secrets — it is [app-settings-store](./app-settings-store.md)'s finding, and this is
the capture-side twin.

**Fix:** route both keys to `credential_fields` (or the keyring, which
`setQwenCredentials`/`ByomApiKeyManager` already uses for the sibling Qwen key), and give
`useAppSetting` an opt-out that does not hydrate the input — render "configured" instead.

### P1 (D) — the masking decision is delegated to an LLM by a prompt line, and the object it returns has no sensitivity flag

`src-tauri/src/commands/credentials/auto_cred_browser.rs:648` and `:726` instruct the model:
*"Set field type to `password` for secrets/tokens, `text` for identifiers."* The declared
output shape (`:625-633`, `:701-709`) is `{key, label, type, required, help_text}` — **no
`sensitive`**. `AutoCredField.field_type` (`:162`) is `#[allow(dead_code)]`; the whole array
travels to the renderer as `discovered_fields: Option<serde_json::Value>` (`:177`) and lands
in `AutoCredReview.tsx:107`.

So the backend gets no opinion at all and correctly defaults to encrypt; the form gets the
model's opinion and obeys it. **The asymmetry that `is_field_sensitive`'s doc comment
describes as non-negotiable is inverted at the only surface the user actually looks at.**

**Fix:** (1) have the Rust side compute `sensitive` from `classify_field_type(&key)` before
handing `discovered_fields` to the renderer, so the backstop applies at the point of
authorship rather than being asked for; (2) drop the two prompt lines — a field the model
labels `text` should still be masked when its key says otherwise, and asking the model
politely is not a control; (3) once (1) lands, `field_type` stops being `dead_code` and
becomes a hint that can only upgrade.

### P2 (E) — the shared secret input tells every password manager it is a login field

`src/features/shared/components/forms/PasswordToggleField.tsx:106`:

```ts
autoComplete={rest.autoComplete ?? 'current-password'}
```

**11 call sites; 3 pass `autoComplete="off"`; 8 inherit `'current-password'.`** Every one of
the 11 captures a *new* credential — a BYOM provider key, a LiteLLM master key, an Ollama key,
a cloud connection secret, an export/import passphrase. `current-password` invites the browser
to autofill an unrelated stored password into an API-key field and invites the manager to save
the API key as a website password.

Repo-wide, the rest of the surface has nothing: **1** `autoComplete` across the 12 other
secret-bearing inputs, **0** `data-1p-ignore` / `data-lpignore` / `data-bwignore`, **0**
`onPaste` handlers. The zero-rows match **all five siblings** (§Warrant (e)) — that half is a
fleet-wide gap, not a Personas defect. The wrong *default* is Personas-specific and is the
worse of the two, because a wrong default is invisible from every call site.

**Fix:** change the default to `'new-password'` (or `'off'`), and add
`data-1p-ignore data-lpignore data-bwignore spellCheck={false}` to the primitive so all 11
sites inherit them.

### P2 (F) — one reveal toggle expires, the other latches

`FieldCaptureRow.tsx:61` holds `isVisible` and `FieldActionButtons` (`FieldCaptureHelpers.tsx:127-138`)
flips it; nothing ever flips it back. `ExtraFieldRenderers.tsx:133` does the same with
`visibleIds`. Meanwhile `PasswordToggleField.tsx:61-94` implements exactly the missing clause —
an 8 s timer, cleared on focus, re-armed on blur only when focus left the wrapper — and
documents why (*"caps shoulder-surf exposure without fighting the user's intent"*).

**Three eye-toggle implementations, one clause, and the correct one is the one the vault form
does not use.** No sibling repo has a reveal toggle at all (0 of 5), so this is Personas
disagreeing with itself, not with the fleet.

**Fix:** extract the auto-revert into a `useAutoRevealTimer(ms)` hook and consume it from all
three, or route `FieldCaptureRow`'s input through `PasswordToggleField`.

### P2 (G) — the credential save discards its error and hardcodes English

```ts
// src/features/vault/sub_credentials/manager/useCatalogHandlers.ts:104-106
} catch {
  setError('Failed to create credential');
}
```

The binding is dropped, so vault-locked, encryption-failed, name-collision and IPC-timeout
produce one message. That message is a hardcoded English literal in a 14-locale app, and
`resolveErrorTranslated` (`src/i18n/useTranslatedError.ts`) is never reached.
`custom/no-silent-catch` does not fire — the block has a body — which is
[the `.catch` / `try-catch` asymmetry](../../../.claude/CLAUDE.md) this repo has already
measured elsewhere.

A second untranslated string sits on the same flow: `OverviewTab.tsx:65-68`, the *"Leave a
field blank to keep its current saved value…"* guidance — good copy, and the only place the
write-only semantics are explained to the user, rendered in English to all 14 locales.

**Fix:** `catch (err) { setError(resolveErrorTranslated(t, err).message); }` and move both
strings into `locales/en.json` → `vault`.

### P3 (H) — the change callback carries the value nobody uses

`CredentialEditForm.tsx:25` — `onValuesChanged?: (key: string, value: string) => void`,
threaded through `CredentialTemplateForm.tsx:68`, `TemplateFormBody.tsx:30`,
`CredentialDesignContext.tsx:43` and `orchestratorContext.ts:30`. **8 consumers, 0 read
either argument**; `useCredentialDesignOrchestrator.ts:143` names them `_key, _value`.

No leak today. It is listed because the narrowing is free (`() => void` compiles at all 8
sites unchanged) and because every future consumer inherits a keystroke stream of secrets by
default. See §4's type answer.

---

## 8. Gaps

1. **The census cannot see an absent mask.** Its instrument is a count of something present.
   "This `<input>` holds a secret and has no `type`" is an absence *and* requires knowing what
   the field holds — neither of which a ratchet can express. §9 gates the **derivation shape**
   (`? 'password'`) because that is the part that is present in a literal; a bare
   `<input type="text">` bound to a credential remains invisible to it. This is the same limit
   `column-encryption-at-rest` §9 hit from the other direction.

2. **No instrument spans the two classifications.** The defect in §0.1 is a *relationship*
   between a Rust function and a TSX ternary, mediated by a JSON column. No lint rule, type
   check or census pattern can compare them. The measurement that found it is the one this
   document ran — replay the Rust classifier over the live catalog and diff it against the
   rendered `type` — and **that is a script somebody should own** (`scripts/check-field-
   sensitivity-parity.mjs`), not a census rule. It has a natural fail-loud precondition: exit 2
   if it reads fewer than 100 field entries.

3. **`FieldCaptureRow` cannot know what it was handed.** Even with a masked default, the
   primitive receives `label`, `value` and `inputType` — no key, no schema, no
   `CredentialFieldMeta`. It has no way to apply the name backstop itself. The classifier must
   be applied by the *caller* or the prop must become the classifier's output; the primitive
   cannot close this alone.

4. **There is no shared "capture a credential" component**, so every fix in §7 must be made
   between two and five times. `PasswordToggleField` and `FieldCaptureRow` overlap heavily and
   neither can absorb the other today (one is a bare input with a toggle, the other owns
   label/error/validation/actions). The consolidation — a single `SecretField` composing
   `FormField` + `PasswordToggleField` — is the real fix and is a bigger change than any
   deviation above. **No sibling repo has one either**, so there is no design to copy.

5. **The browser is the last hop and it is not ours.** Autofill, form history, password-manager
   capture and IME/spellcheck buffers all sit below the app. `autoComplete` and the
   `data-*-ignore` attributes are *requests*, honoured inconsistently. The only structural
   answer is the one `brainiac` took — never bind the value in the host language at all — and
   Tauri's webview does not offer server actions, so this repo cannot take it.

6. **Nothing verifies that a saved credential is the one that was typed.** The write path
   verifies its own round trip in Rust (`credentials.rs:1383` `verify_field_roundtrip`), but
   the form gets back a `PersonaCredential` with no field data, so a trimmed, truncated or
   partially-encrypted value is indistinguishable from a good one until first use. That is
   the capture-side twin of
   [column-encryption-at-rest](./column-encryption-at-rest.md) §7 P2.

---

## 9. The missing gate

### The condition, stack-free

> **Whether a field is masked is derived at render time from data an untrusted party
> authored, rather than from the fail-secure classifier that already decided it, and the
> derivation's fallback is "visible".**

There is no runtime signal. A field that should be masked and isn't looks exactly like a
field that is correctly visible; it renders, it validates, it saves, it encrypts at rest, and
the only observer who could notice is the person reading their own token off the screen. The
condition is the same silent-success family as
[column-encryption](./column-encryption-at-rest.md)'s delimiterless prefix and
[retention](./retention-and-pruning.md)'s status allowlist — a policy expressed as a
derivation over authored data, where every case the author got wrong is wrong forever.

**The proxy, for this stack:** a JSX `type` or `inputType` attribute whose value is a
conditional expression selecting the string `'password'` in its **true** branch. The
direction is the discriminator and it is not arbitrary: a *classification* reads
`isSecret ? 'password' : 'text'`, while a *reveal toggle* — the legitimate use of a
conditional here — reads `revealed ? 'text' : 'password'`. **The two populations are
mutually exclusive by construction**, and the compliant half also contains the unconditional
literal (`type="password"`, `inputType="password"`, `<PasswordToggleField`), which is what
§2 actually prescribes.

**What the next repo must re-derive.** This signal keys on React/JSX attribute markup and on
the literal strings `'password'`/`'text'`. A repo using a `<SecretInput>` component, a
`masked` boolean prop, a form-schema `widget` field, or Vue/Svelte/Angular binding syntax has
**the same condition wearing markup this pattern cannot see**. Re-derive the proxy against
the local idiom; keep the condition and the direction test.

### Existing rules checked first

I read all **122** rules in `scripts/census/rules.json` before authoring, and checked these
six by name:

- **`render-time-redaction-toggle`** (`secret-and-pii-redaction.md`, 3 files / 5 matches,
  `roots: ["src"]`, `.ts/.tsx`) — **the nearest neighbour, and the closest call.** Same root,
  same extensions, and also a ternary about secrecy. But it anchors on a **redaction function
  call** in the *false* branch (`sanitizeErrorForDisplay|sanitizeErrorMessage|maskSensitiveJson|redactObject|scrubPii`),
  and mine anchors on the **string literal `'password'`** in the *true* branch of a JSX
  `type` attribute. I checked the match sets directly: **zero file overlap and zero match
  overlap** — none of its 5 matches is inside a `type=`/`inputType=` attribute, and none of my
  4 calls a redactor. It governs *displaying a value that already exists*; this governs
  *capturing one that does not yet*.
- **`secret-as-bare-string-field`** (`secret-display-and-transfer.md`, 10/12,
  `roots: ["src-tauri"]`, `.rs`) — different language, different root. Disjoint by
  construction.
- **`settings-key-holding-secret`** (`app-settings-store.md`, 1/3,
  `roots: ["src-tauri/db/src"]`) — keys on a Rust `pub const …API_KEY: &str = "` declaration.
  It is the *destination* half of my §7.C and I confirmed it does not reach the form side: no
  overlap.
- **`stateless-disclosure-control`** (`expandable-row.md`, 56/59, `roots: ["src"]`, `.tsx`) —
  the closest by *subject* (a control that reveals content without declaring it). It keys on
  a `<button>` opening tag with expand/collapse vocabulary and no `aria-expanded`; my §7.F
  reveal toggles do carry `aria-pressed`. Checked: **no shared match.**
- **`hand-rolled-disabled-state`** / **`illegible-foreground-alpha`** (`design-token-usage.md`,
  `theming-and-contrast.md`) — both key on Tailwind class strings over the same root. Reviewed
  because my sites are JSX-heavy; both patterns require a `text-`/`disabled:` class token and
  neither can match inside a `type=` attribute. No overlap.

**No existing rule looks at how a security-relevant boolean is derived at render time.** The
corpus gates declarations, call sites, statements, types, class strings and — since
`column-encryption-at-rest` — the body of a regex literal. **The derivation is an
expression**, and nothing in the corpus reads an expression's *branch direction*. That is the
territory gap this rule fills, and it is why the condition survived: at every one of the four
sites the code is type-correct, lint-clean, tested, and reads as ordinary.

### Where it runs

`npm run census:check`, which is a step of **`npm run check`** — the script the PR
self-review ritual in `.claude/CLAUDE.md` requires green before a branch leaves the box — and
which the `golden-path-census` **pre-push** job also runs. **Deliberately not CI-only:** per
the brief's calibration, `ci.yml` is red on 10 pre-existing Rust failures, so a gate that only
runs there runs nowhere.

**How it fails loudly if its own precondition is absent** — inherited from the runner, not
re-derived: the run **fails** when the walk sees fewer than `floor: 4000` files (measured
**4,829**, consistent with `shared-facts.json`'s 4,828 `.ts` + 2,104 `.tsx` over this root),
when the rule matches zero files anywhere, when an `exclude` entry goes stale, when the count
rises, **and when it drops without the baseline moving**. Surviving counts print on success,
so a build log distinguishes a clean run from one that checked nothing.

### The signal, and its precision

**4 matches in 4 files, all four hand-opened. Precision 4/4.** Every one has a legal fix and
a compliant sibling in the same tree:

| site | derivation | why it is violating | legal fix |
|---|---|---|---|
| `EditFormFields.tsx:44` | `field.type === 'password' ? 'password' : …'text'` | connector-schema `type`, fallthrough visible; the same object's `sensitive` says encrypt for 43 of these | read `CredentialFieldMeta.isSensitive`; upgrade-only |
| `AutoCredReview.tsx:107` | `field.type === 'password' ? 'password' : 'text'` | `field.type` is **model-authored** (`auto_cred_browser.rs:648`) | compute `sensitive` server-side from `classify_field_type` |
| `QuickAddCredentialModal.tsx:382` | `isPassword ? 'password' : 'text'` (`:355`) | same schema derivation, hand-rolled input | same |
| `FieldCaptureRow.tsx:119` | `isSecret && !isVisible ? 'password' : … 'text'` | `isSecret = inputType === 'password'` and **`inputType` defaults to `'text'`** (`:51`) — the primitive's own fallback is visible | flip the default to `'password'` |

The fourth is the one worth defending, because it is also a reveal toggle and could look like
a false positive. It is not: the conditional's *first* operand is the classification
(`isSecret`), the reveal (`!isVisible`) merely gates it, and the `else` chain ends at
`'text'`. **A pure reveal toggle has no classification operand at all** — which is exactly
what the three control sites look like.

### The positive control — it partitions the anchor

The anchor is "code that decides whether an input is masked". The violating half derives it
from authored data with a visible fallback; the compliant half either states it
unconditionally or derives it from a *reveal* flag whose false branch is `'password'`. **They
are disjoint by construction** — `? 'password'` and `? 'text' : 'password'` cannot both match
one conditional — and together they are the whole surface.

```
  rule                                             files  base  matches  base  walked  floor
  OK  data-decided-secret-masking                      4     4        4     4    4829   4000
  OK  data-decided-secret-masking-positive-control     11     —       15     —    4829   4000
```

**15 compliant vs 4 violating — a 3.75:1 partition of the same anchor, not a ratio against an
unrelated population.** The decisive pair is inside one feature folder:
`sub_catalog/.../negotiator/NegotiatorStepCardHelpers.tsx` contributes **1 control match and
0 rule matches** (`inputType="password"`, a literal), while its sibling
`sub_catalog/.../autoCred/steps/AutoCredReview.tsx` contributes **1 rule match and 0 control
matches**. Two AI-driven credential-capture screens, same directory, opposite postures — so
the rule is discriminating on the *derivation*, not on "files about credentials". A
vocabulary-keyed rule would report both, and would report the negotiator (the exemplar §3
tells you to copy) as violating.

```json
{
  "id": "data-decided-secret-masking",
  "goldenPath": "docs/concepts/golden-paths/credential-capture-form.md",
  "title": "Whether an input is masked is derived at render time from author-supplied data, with a visible fallback — instead of from the fail-secure classifier that already decided it.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:\\binputType|\\btype)=\\{[^{}]{0,140}\\?\\s*['\"]password['\"]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A JSX `type=` or `inputType=` attribute whose value is a conditional expression selecting the literal 'password' in its TRUE branch — i.e. a masking decision computed from data at render time. PROXY FOR the stack-free condition: whether a field is masked is derived from data an untrusted party authored, rather than from the fail-secure classifier that already decided it, and the derivation's fallback is 'visible'. THE DIRECTION IS THE DISCRIMINATOR AND IT IS NOT ARBITRARY: a CLASSIFICATION reads `isSecret ? 'password' : 'text'` (matched); a REVEAL TOGGLE — the one legitimate conditional here — reads `revealed ? 'text' : 'password'` (not matched, and counted by the positive control instead). The two populations are mutually exclusive by construction: one conditional cannot have 'password' in both branches. LEGAL DESTINATION: the backend's verdict, which already crosses IPC as CredentialFieldMeta.isSensitive (src/lib/bindings/CredentialFieldMeta.ts, produced by list_credential_fields at src-tauri/src/commands/credentials/crud.rs:460 from is_field_sensitive at src-tauri/db/src/repos/resources/credentials.rs:80) — a three-tier classifier with a secret-NAME backstop that a user- or AI-authored schema CANNOT downgrade, plus a fail-secure default for unknown keys. It has ZERO frontend consumers in 4,829 files. MEASURED 2026-08-16 at ec1bf0359: 4 files / 4 matches, ALL FOUR HAND-OPENED, precision 4/4, and the control below reports 15 compliant matches in 11 files (a 3.75:1 partition of the same anchor). Counts reproduced by a SECOND, STRUCTURALLY INDEPENDENT implementation — a TypeScript-compiler AST walk over JsxAttribute -> ConditionalExpression nodes, not a second regex — which agreed on MEMBERSHIP, not merely on the total. WHY IT IS A DEFECT AND NOT STYLE: replaying is_field_sensitive and classify_field_type over the live connector_definitions table (134 connectors, 196 field entries) and diffing against what the form renders gives 119 agree-masked, 32 agree-plain, ZERO masked-when-plaintext, and 45 ENCRYPTED-AT-REST-BUT-RENDERED-IN-CLEARTEXT. 43 of those 45 are one JSON object contradicting itself — `sensitive: true` beside `type: 'text'` — and 2 are the backend's name backstop overriding a declared `sensitive: false` (higgsfield.key_id, langfuse.public_key) while the form obeys the downgrade. The worst site is AutoCredReview.tsx:107, where `field.type` is chosen by a LANGUAGE MODEL following one prompt line at src-tauri/src/commands/credentials/auto_cred_browser.rs:648 ('Set field type to \"password\" for secrets/tokens, \"text\" for identifiers'), and whose returned object carries NO `sensitive` key at all — so the backend defaults to encrypt and the form defers to the model. FOURTH MATCH DEFENDED: FieldCaptureRow.tsx:119 is `isSecret && !isVisible ? 'password' : ...` and is a TRUE positive, not a reveal toggle — the conditional's first operand is the classification and the primitive's own `inputType` default is 'text' (:51), so the fallback is visible. LEGAL FIX, in order: (1) flip FieldCaptureRow's default to inputType = 'password' and pass 'text' explicitly for the 32 genuinely-public fields, so the failure direction becomes over-masking; (2) join `fields` to listCredentialFields() by fieldKey and bind masking to isSensitive, letting the schema's `type` only ever UPGRADE to masked; (3) compute `sensitive` from classify_field_type server-side before handing discovered_fields to the renderer, so the backstop applies at authorship. THE COMPLIANT FORM IS 8 LINES AWAY IN THE SAME FEATURE FOLDER: src/features/vault/sub_catalog/components/negotiator/NegotiatorStepCardHelpers.tsx:118 writes inputType=\"password\" as an unconditional literal. DO NOT silence a match by inverting the ternary to `x ? 'text' : 'password'` unless the condition genuinely became a REVEAL flag — inverting a classification preserves the defect exactly and merely moves it into the control. DO NOT silence it by hoisting the ternary into a variable above the JSX either; that hides it from this signal without changing the fallback. The honest fix always makes the DEFAULT masked. PRECONDITION (must be re-derived per repo): this signal keys on React/JSX attribute markup and the literal strings 'password'/'text'. A repo using a <SecretInput> component, a `masked` boolean prop, a schema `widget` field, or Vue/Svelte binding syntax has the same condition wearing markup this pattern cannot see. END OF LIFE: this rule is designed to reach zero. When it does, the runner fails structurally on zero matches BY DESIGN — DELETE the rule then, do not baseline it at 0.",
    "$measured": "2026-08-16 @ ec1bf0359 — 4,829 .ts/.tsx files walked; commentMatchesSkipped 0; validated standalone in a scratch registry unique to this composer, counts reproduced by a TypeScript-AST implementation with identical membership, then re-extracted from this finished document and re-run: identical. Runtime 0.87 s for both rules together. The full registry was NOT run."
  },
  "baseline": { "files": 4, "matches": 4 },
  "floor": 4000
}
```

```json
{
  "id": "data-decided-secret-masking-positive-control",
  "goldenPath": "docs/concepts/golden-paths/credential-capture-form.md",
  "title": "POSITIVE CONTROL — not a gate. The same masking decision made unconditionally, or derived from a reveal flag: the compliant half of the anchor, which this rule must never report.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:\\binputType|\\btype)=\\{[^{}]{0,140}\\?\\s*['\"]text['\"]\\s*:\\s*['\"]password['\"]\\s*\\}|(?:\\binputType|\\btype)=[\"']password[\"']|<PasswordToggleField",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE — carries no baseline by design. Same roots, same extensions, same 4,829-file walk, pointed at the COMPLIANT half of the identical anchor ('code that decides whether an input is masked'): an unconditional literal (type=\"password\" / inputType=\"password\"), the shared masked-input primitive (<PasswordToggleField), or a conditional whose FALSE branch is 'password' — i.e. a REVEAL toggle rather than a classification. DISJOINT FROM THE RULE BY CONSTRUCTION: one conditional cannot carry 'password' in both branches, and a literal attribute has no conditional at all. MEASURED 2026-08-16 at ec1bf0359: 11 files / 15 matches against the rule's 4 / 4 — a 3.75:1 partition. commentMatchesSkipped 2 (PasswordToggleField's own doc comment names type=\"password\" twice; the runner correctly strips both, which is itself evidence ignoreCommentLines is live). THE DECISIVE PAIR SITS IN ONE FEATURE FOLDER: src/features/vault/sub_catalog/components/negotiator/NegotiatorStepCardHelpers.tsx contributes 1 CONTROL match and 0 rule matches (inputType=\"password\", an unconditional literal on the AI-guided paste-a-secret screen), while its sibling src/features/vault/sub_catalog/components/autoCred/steps/AutoCredReview.tsx contributes 1 RULE match and 0 control matches (the model-authored `field.type` derivation). Two AI-driven credential-capture screens, same directory, opposite postures — so the rule discriminates on the DERIVATION and not on 'files about credentials'. A vocabulary-keyed rule would light up both and would report the exemplar this golden path tells you to copy as violating. Other control files: shared/components/forms/PasswordToggleField.tsx (the primitive, plus its own reveal ternary at :101), and its 8 remaining call sites across sub_deployment/cloud, sub_model_config, sub_byom and sub_portability; plus triggers/sub_triggers/configs/WebhookConfig.tsx:38 and vault/sub_catalog/components/schemas/ExtraFieldRenderers.tsx:133, both genuine reveal toggles. Run both together whenever the rule's pattern is edited: if this control's count collapses, the walk or the anchors broke rather than the codebase being fixed. It is expected to RISE as the 4 violations are converted — every derivation replaced by a masked default increments it — which is exactly why it must never be baselined.",
    "$measured": "2026-08-16 @ ec1bf0359 — 11 files / 15 matches via the real runner; commentMatchesSkipped 2."
  },
  "floor": 4000
}
```

### Verification of this gate's own preconditions

- **Backtracking checked, not assumed.** The rule is
  `(?:\binputType|\btype)=\{[^{}]{0,140}\?\s*['"]password['"]` — one bounded negated class
  with a **capped** quantifier, one alternation of two literals, no nested quantifier, no
  alternation inside a quantifier, no lookbehind. The `[^{}]` class also **cannot cross a
  nested JSX expression**, which is what keeps the attribute boundary honest. Real-runner
  wall time over 4,829 files: **0.87 s for both rules together.**
- **`floor: 4000` against 4,829 walked**, matching the dominant precedent for
  `roots: ["src"] / [".ts",".tsx"]` (`raw-web-storage`, `unqueryable-log-record` and others
  use 4000) — several rules over one root must not hold different opinions about what "the
  tree is intact" means. A typo'd root walks 0 files and trips both `floor` and the zero-match
  structural failure.
- **`commentMatchesSkipped: 0` on the rule, `2` on the control.** The rule's flag is currently
  inert and is kept because the legal fix involves writing prose *about* these ternaries; the
  control's 2 prove the option is live, not decorative.
- **Two independent implementations, agreeing on membership.** The runner's Node `RegExp`
  and a TypeScript-compiler AST walk (`ts.isJsxAttribute` → collect `ConditionalExpression` →
  test `whenTrue`/`whenFalse` string literals) both return the **same four files at the same
  four lines**, and both return the same compliant set. This is the doctrine's stronger test:
  the second implementation is structural, not a second regex, so a shared blind spot in
  regex composition cannot produce false agreement. Ripgrep was **not** available on this
  machine, so the Rust-engine cross-check that `column-encryption-at-rest` used was replaced
  with this one; the pattern uses no lookarounds and would port to the Rust `regex` crate
  unchanged.
- **Re-extraction check performed.** Both JSON blocks above were pasted back out of this
  finished document into `rules-credential-capture-form-probe.json` in the scratchpad
  (filename unique to this composer) and re-run through the real runner —
  `node scripts/census/run-census.mjs --rules <scratch>/…`, not a re-implementation.
  Identical: **4 / 4 / 4,829 / floor 4000** and **11 / 15**, no baseline on the control, no
  structural problems, exit 0.
- **No `exclude` entries.** All four matches are true positives, so there is no legitimate
  exemption and no stale suppression can accumulate.
- Do **not** run `npm run census -- --update` against a registry containing the positive
  control; `updateBaselines` dereferences `baseline.files` unconditionally.
- **The full registry was NOT run**, per the doctrine. The orchestrator runs it on merge.
- **This rule can and should reach zero**, and the path is short: three of the four are one
  `isSensitive` join, the fourth is a changed default. When it reaches zero the runner fails
  structurally on a zero-match rule **by design** — **delete it then, do not baseline it
  at 0.**

### Gates I rejected, with numbers

Refusing to gate is first-class, so here are the three candidates I measured and declined:

| candidate | violating | compliant | why rejected |
|---|---:|---:|---|
| **a secret-bearing `<input>` with no `type` attribute at all** | — | — | **The census cannot assert an absence.** And identifying "secret-bearing" needs the field's *semantics*, not its markup: my best vocabulary attempt returned 13 hits of which 11 were `credentialName` (not a secret) and one a search box. **2/13 precision.** Declined twice over. |
| **a secret-named `useState` holding a credential** (`useState` whose setter name matches key/token/secret/passphrase) | 2 files / 2 | — | Precision is fine (`ByomApiKeyManager.tsx:261`, `ExportSection.tsx:42`) and both are real. But **the legal fix is contested**: a keyring-backed one-shot key row that clears on save is defensible in `useState`, and the corpus's own §0.4 shows the ref discipline is a *form*-level property, not a per-`useState` one. A gate that fires on two defensible sites is a to-do list. Carried as P6/§4 prose instead. |
| **`autoComplete` missing on a masked input** | 12 files / 12 | 4 | Highest raw count of the three and a real defect (§7.E). Rejected because **the fix is a changed default in one file, not 12 edits** — `PasswordToggleField.tsx:106` corrects 8 of the 12 at a stroke — and the contract is explicit that *"a gate on reaching a destination is only as good as the destination's defaults; prefer fixing the default over counting the callers."* Ratcheting 12 call sites would have held the line at the wrong altitude and gone green while the default stayed wrong. |

The general limit worth stating: **the census can ratchet a derivation that is present in an
expression, and can say nothing about whether the value that derivation reads is true.** The
largest finding in this document — 45 fields where two classifications disagree — is a
relationship between a Rust function, a JSON column and a TSX ternary, and it was found by
**executing the Rust classifier against the live catalog**, not by matching anything. §8 Gap 2
specifies the instrument that would own it, and it is a script with a fail-loud precondition,
not a rule.

---

## 12. Corrections to the brief

The brief primed five leads and asked four questions. **Two leads were correct and
understated, one was correct and is now closed, one was correct but does not reach this leaf,
and one was the wrong frame.**

**1. "`is_field_sensitive` is the best small design in this territory — measure whether the
*form* honours the same classification the backend does." CORRECT, and this became the
document.** The answer is no, and it is worse than "the form has no classifier": **the
backend's verdict already crosses IPC** as `CredentialFieldMeta.isSensitive`, ts-rs-exported,
and has **zero frontend consumers in 4,829 files**, while the form reads a *different key of
the same JSON object* — `type` — with no backstop. Replaying the classifier over the live
catalog: **45 of 196 fields encrypted at rest and rendered in cleartext, 0 the other way.**
The brief said "go past it"; the way past it turned out to be that the backstop's own doc
comment names the exact threat (*"the connector schema is user/AI-authorable"*) and the form's
input is authored by a **language model**, by a prompt line at `auto_cred_browser.rs:648`.

**2. "Renaming a credential wiped its entire metadata blob until 2026-08-15." CORRECT and
CLOSED — verified in place, not taken on trust.** `src/api/vault/credentials.ts:26-41` now
types `updateCredential` as `Partial<UpdateCredentialInput>` and carries the
`Option<Option<String>>`/`double_option` mechanism and the "18 of 18 keys lost across 3 live
rename payloads" measurement in its comment; `credentialSlice.ts:179-195` carries the
matching note on which nulls are inert and which is destructive. **Worth recording *why* the
fix is durable:** it kept the explanation of the *other four* nulls, so the next editor
cannot re-introduce the bug by making the signature symmetric again.

**3. "The frontend masker was one of three copies of a broken regex (fixed 2026-08-15); the
Sentry scrubber had zero credential patterns (fixed 2026-08-16)." CORRECT and CLOSED — both
verified.** `maskSensitive.ts:85-101` and `main.rs:201-218` now carry byte-identical
per-class forms with `gh[pousr]_`, `sk-ant-`, `AIza`, `xox[baprs]-`, `AKIA` and the JWT
triple, each under a comment quoting the old broken literal. **One observation offered
upward:** both fixes were made by copying `core/src/redact.rs`, and the comments say so — so
the tree now has *four* correct copies of one pattern set instead of one correct and three
broken. The count of copies did not change, and neither did the mechanism that let them
drift. That is a *containment* of `column-encryption-at-rest` §7 P0, not a closure of it, and
its §3 already names the missing chokepoint.

**4. "Autosave, draft persistence and reseed-on-refetch are live hazards: 38 reseed effects
clobber user edits, 3 persisted drafts have 0 invalidation, and a `clearDraft` has zero call
sites." CORRECT about the repo, and it does NOT reach this leaf — which I verified rather than
assumed, because a clean result here is only worth reporting if it was actually measured.**
The vault capture form is one of the *correct* reseed sites: `editedFieldsRef`
(`CredentialEditForm.tsx:84-94`) guards per key and its comment names the caller that forced
it. There is no autosave on any credential field. And the live app's storage was probed
through the harness: **80 `localStorage` keys, 113,507 bytes, 0 `sessionStorage`, 0
credential-shaped or labelled-secret values.** The only credential-adjacent persisted draft
(`trigger_studio_draft_v1`) carries links, not trigger config, so the webhook HMAC secret
typed at `WebhookConfig.tsx:37` never enters it. **Personas is materially better here than
two siblings** — `vibeman` ships a plaintext `llm_api_keys` localStorage vault with three
readers, and `personas-cloud` git-tracked a log containing two OAuth-token-shaped strings.

**5. "A credential import is keyed by name with no `existing_id`, and needs a precondition it
does not have." — the wrong frame for this leaf, and I am declining it rather than
half-answering it.** The claim is real at `data_portability.rs:6024` (a
`SELECT COUNT(*) … WHERE name = ?1 AND service_type = ?2` dedupe with no id) and
`:9450` (`.find(|c| c.name == imported_name && c.service_type == entry.service_type)`), and
the surrounding code does thread `existing_id` for **projects, twins, tools and workspaces**
— so credentials are the outlier, which is what makes it look like this leaf's problem. It is
not: **nobody types anything.** Import is a file-driven bulk write with no form, no masking
decision, no field lifetime and no user in the loop, and its correct owner is a
portability/merge-conflict leaf where "what does the second import of the same bundle do"
is the subject. Claiming it here would have inflated this document with a defect it has no
prescription for. **Recorded as a hand-off, not as a finding.**

**And the brief's five questions, answered.**

*Which inputs are `type="password"` and which are not?* — **17 masked sites; 5 distinct
capture components; 3 distinct eye toggles, of which 1 expires.** For catalog credentials the
answer is decided per field by `schemaField.type`, and **45 of 196 fields are encrypted at
rest and unmasked on screen** (§0.1). The primitive's default is `'text'`.

*Does any secret value reach component state, a store, localStorage, a draft, a log, or an
error message?* — **No, on all six, and each was measured rather than reasoned.** State: a
ref, with a test pinning it. Store: neither `partialize` touches a credential path.
localStorage/sessionStorage: probed live, 0 of 80 keys. Draft: none carries one. Log:
`logSecretSafeError` logs `err.name` and the settings key. Error message: validation
interpolates `field.label`. **The one thing that does reach a place it should not is a
`type: 'password'` field's value landing in `app_settings` via `useAppSetting` — plaintext,
and read back into the input on mount (§7.C).**

*Is paste handled?* — **No, anywhere, in any of the six repos.** Zero `onPaste` handlers on a
secret field and zero password-manager opt-outs. What *is* handled is the paste's
consequences: `computeValidationGlow` warns on interior whitespace and short values (the two
paste-error shapes), and the clipboard is wiped 30 s after a copy. The unhandled half is the
browser's — and the shared primitive currently tells it `autoComplete="current-password"`,
which is the wrong answer for all 11 of its call sites (§7.E).

*What does the form do with the value after a failed save?* — **It keeps it, and that is
correct** (P7): `valuesRef` survives the rejected promise, the modal stays mounted, and the
user does not have to re-fetch a secret from a page they have closed. `ascent` reaches the
same behaviour by control-flow accident. **What the form does badly is the other half:**
`useCatalogHandlers.ts:104` is a `catch {}` that drops the binding and substitutes one
hardcoded English string for four distinguishable failures (§7.G).

*And the one the brief did not ask, which turned out to matter most:* **can the form read a
stored secret back?** No — `CredentialFieldMeta` carries `isSensitive` and no value, and
`get_decrypted_fields` never reaches a command return type. That single omitted field is why
this document's containment section is a list of green rows, and it is the strongest
"prefer a type over a gate" instance in the leaf: `ascent`, which made the other choice, has
the re-display bug (`AlertsControl.tsx:104-108`) that Personas **cannot express**.

**One correction to my own first draft.** I expected the headline to be "a typed secret
survives somewhere it should not", and spent the first third of the sweep hunting for it —
storage, stores, drafts, logs, toasts, IPC payloads. **It does not.** The containment is
genuinely good and in two places (the ref discipline and the valueless read type) it is
best-in-fleet. I only know that because I probed the *running* app rather than reading the
persistence code, and because the convergence oracle showed me what the alternative looks
like in two sibling repos that did leak. **The defect in this leaf is not where the secret
goes — it is whether the app knows it was one**, and I would have missed it entirely if the
brief had not said "measure whether the form honours the same classification the backend
does."
